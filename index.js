const express = require("express");
const crypto = require("crypto");
const stringSimilarity = require("string-similarity");
const { sendServerMessage } = require("./services/cftoolsService");

require("dotenv").config();

const PORT = process.env.PORT || 8080;
const CF_WEBHOOK_SECRET = process.env.CF_WEBHOOK_SECRET;

const app = express();
app.use(express.json());

const CLAIMS = {}; // Stores active POI claims
const CLAIM_REGEX = /\bCLAIM\s+([A-Za-z0-9_ -]+)\b/i;
const CHECK_CLAIMS_REGEX = /\bcheck claims\b/i; // Detects "check claims" command

// 🛑 POIs that should NOT be listed in "Check Claims"
const EXCLUDED_POIS = [
    "Heli Crash (Active Now)",
    "Hunter Camp (Active Now)",
    "Airdrop (Active Now)"
];

// 🟢 POI LIST with Abbreviations for "Check Claims"
const POI_MAP = {
    "Sinystok Bunker T5": "Sinystok Bunker",
    "Yephbin Underground Facility T4": "Yephbin",
    "Rostoki Castle T5": "Rostoki",
    "Svetloyarsk Oil Rig T4": "Oil Rig",
    "Elektro Radier Outpost T1": "Elektro",
    "Tracksuit Tower T1": "Tracksuit Tower",
    "Otmel Raider Outpost T1": "Otmel",
    "Svetloyarsk Raider Outpost T1": "Svetloyarsk",
    "Solenchny Raider Outpost T1": "Solenchny",
    "Klyuch Military T2": "Klyuch",
    "Rog Castle Military T2": "Rog",
    "Zub Castle Military T3": "Zub",
    "Kamensk Heli Depot T3": "Kamensk",
    "Tisy Power Plant T4": "Tisy",
    "Krasno Warehouse T2": "Krasno",
    "Balota Warehouse T1": "Balota",
    ...EXCLUDED_POIS.reduce((acc, poi) => ({ ...acc, [poi]: poi }), {}) // Ensure excluded POIs exist in mapping
};

// 🟢 Reverse POI Lookup (for claim detection)
const POI_LIST = Object.keys(POI_MAP);

// 🟢 Dictionary for First Word Matching
const FIRST_WORDS_MAP = {};
POI_LIST.forEach(poi => {
    const firstWord = poi.split(" ")[0].toLowerCase();
    FIRST_WORDS_MAP[firstWord] = poi;
});

// Lowercase POI list for similarity matching
const POI_LIST_LOWER = POI_LIST.map(poi => poi.toLowerCase());

/**
 * Validate webhook signature
 */
function validateSignature(req) {
    const deliveryUUID = req.headers["x-hephaistos-delivery"];
    const receivedSignature = req.headers["x-hephaistos-signature"];

    if (!deliveryUUID || !receivedSignature) {
        console.log("❌ Missing Webhook Signature Headers");
        return false;
    }

    const localSignature = crypto.createHash("sha256")
        .update(deliveryUUID + CF_WEBHOOK_SECRET)
        .digest("hex");

    if (localSignature !== receivedSignature) {
        console.log("❌ Webhook signature mismatch!");
        return false;
    }

    return true;
}

/**
 * Webhook endpoint for CFTools events
 */
app.post("/webhook", async (req, res) => {
    if (!validateSignature(req)) {
        return res.sendStatus(403);
    }

    const eventType = req.headers["x-hephaistos-event"];
    const eventData = req.body;

    console.log(`[${new Date().toISOString()}] 🔹 Received Event: ${eventType}`);

    if (eventType === "verification") {
        console.log("✅ Webhook Verified Successfully!");
        return res.sendStatus(204);
    }

    if (eventType !== "user.chat") {
        console.log(`ℹ️ Ignoring unrelated event type: ${eventType}`);
        return res.sendStatus(204);
    }

    const messageContent = eventData.message.toLowerCase();
    const playerName = eventData.player_name;

    console.log(`[Game Chat] ${playerName}: ${messageContent}`);

    // 🟢 Check if player typed "check claims"
    if (CHECK_CLAIMS_REGEX.test(messageContent)) {
        let availablePOIs = POI_LIST.filter(poi => !CLAIMS[poi] && !EXCLUDED_POIS.includes(poi)); // Only show unclaimed POIs

        if (availablePOIs.length === 0) {
            await sendServerMessage("All POIs are currently claimed.");
        } else {
            // 🚀 Use abbreviated POI names for output
            let formattedPOIs = availablePOIs.map(poi => POI_MAP[poi]);
            let availableList = formattedPOIs.join(", ");

            await sendServerMessage(`Available POIs: ${availableList}`);
        }
        return res.sendStatus(204);
    }

    // 🟢 Check if player is claiming a POI
    const match = messageContent.match(CLAIM_REGEX);
    if (match) {
        let detectedPOI = match[1].trim().toLowerCase();
        let detectedFirstWord = detectedPOI.split(" ")[0];

        let bestFirstWordMatch = stringSimilarity.findBestMatch(detectedFirstWord, Object.keys(FIRST_WORDS_MAP));
        let correctedPOI = bestFirstWordMatch.bestMatch.rating > 0.5
            ? FIRST_WORDS_MAP[bestFirstWordMatch.bestMatch.target]
            : detectedPOI;

        if (bestFirstWordMatch.bestMatch.rating < 0.5) {
            let bestMatch = stringSimilarity.findBestMatch(detectedPOI, POI_LIST_LOWER);
            if (bestMatch.bestMatch.rating > 0.5) {
                correctedPOI = POI_LIST[bestMatch.bestMatchIndex];
            }
        }

        if (!POI_LIST.includes(correctedPOI)) {
            console.log(`❌ Invalid Claim: ${playerName} attempted to claim an unknown POI: ${correctedPOI}`);
            return res.sendStatus(204);
        }

        console.log(`[CLAIM DETECTED] Player: ${playerName} | POI: ${POI_MAP[correctedPOI]} (Originally: ${match[1].trim()})`);

        if (CLAIMS[correctedPOI]) {
            let timeSinceClaim = Math.floor((Date.now() - CLAIMS[correctedPOI].timestamp) / 60000);
            let responseMessage = `${CLAIMS[correctedPOI].player} already claimed ${POI_MAP[correctedPOI]} ${timeSinceClaim} minutes ago.`;
            console.log(`🚫 POI Already Claimed: ${responseMessage}`);
            await sendServerMessage(responseMessage);
        } else {
            CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
            let claimMessage = `${playerName} claimed ${POI_MAP[correctedPOI]}.`;
            console.log(`✅ Claim Accepted: ${claimMessage}`);
            await sendServerMessage(claimMessage);

            setTimeout(() => {
                delete CLAIMS[correctedPOI];
                console.log(`🕒 POI Reset: ${POI_MAP[correctedPOI]} is now available again.`);
            }, 45 * 60 * 1000); // Reset after 45 minutes
        }
    }

    res.sendStatus(204);
});

/**
 * Start the Express server
 */
app.listen(PORT, () => {
    console.log(`🚀 Webhook Server listening on port ${PORT}`);
});
