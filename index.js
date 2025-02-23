const express = require("express");
const crypto = require("crypto");
const stringSimilarity = require("string-similarity");
const { sendServerMessage } = require("./services/cftoolsService");

require("dotenv").config();

const PORT = process.env.PORT || 8080; // Railway uses 8080
const CF_WEBHOOK_SECRET = process.env.CF_WEBHOOK_SECRET;

const app = express();
app.use(express.json());

const CLAIMS = {}; // Stores active POI claims
const CLAIM_REGEX = /\bCLAIM\s+([A-Za-z0-9_ -]+)\b/i;

const POI_LIST = [
    "Sinystok Bunker T5", "Yephbin Underground Facility T4", "Rostoki Castle T5",
    "Svetloyarsk Oil Rig T4", "Elektro Radier Outpost T1", "Tracksuit Tower T1",
    "Otmel Raider Outpost T1", "Svetloyarsk Raider Outpost T1", "Solenchny Raider Outpost T1",
    "Klyuch Military T2", "Rog Castle Military T2", "Zub Castle Military T3",
    "Kamensk Heli Depot T3", "Tisy Power Plant T4", "Krasno Warehouse T2",
    "Balota Warehouse T1", "Heli Crash (Active Now)", "Hunter Camp (Active Now)", "Airdrop (Active Now)"
];

// Create a dictionary of first words mapped to full POI names
const FIRST_WORDS_MAP = {};
POI_LIST.forEach(poi => {
    const firstWord = poi.split(" ")[0].toLowerCase(); // Get the first word of the POI
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
    const eventType = req.headers["x-hephaistos-event"];
    const eventData = req.body;

    console.log(`[${new Date().toISOString()}] 🔹 Received Event: ${eventType}`);
    console.log(`📜 Full Event Data:`, JSON.stringify(eventData, null, 2)); // Debugging log

    // ✅ Webhook Verification Handling
    if (eventType === "verification") {
        console.log("✅ Webhook Verified Successfully!");
        return res.sendStatus(204);
    }

    // ✅ Accept `user.chat` Events
    if (eventType !== "user.chat") {
        console.log(`ℹ️ Ignoring unrelated event type: ${eventType}`);
        return res.sendStatus(204);
    }

    if (!validateSignature(req)) {
        return res.sendStatus(403);
    }

    // ✅ Extract Player Name & Message (Using Correct Keys)
    const playerName = eventData.player_name || "Unknown Player"; // Corrected key
    const messageContent = eventData.message || ""; // Corrected key

    console.log(`[Game Chat] ${playerName}: ${messageContent}`);

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

        console.log(`[CLAIM DETECTED] Player: ${playerName} | POI: ${correctedPOI} (Originally: ${match[1].trim()})`);

        if (CLAIMS[correctedPOI]) {
            let timeSinceClaim = Math.floor((Date.now() - CLAIMS[correctedPOI].timestamp) / 60000);
            let responseMessage = `${CLAIMS[correctedPOI].player} already claimed ${correctedPOI} ${timeSinceClaim} minutes ago.`;
            console.log(`🚫 POI Already Claimed: ${responseMessage}`);
            await sendServerMessage(responseMessage);
        } else {
            CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
            let claimMessage = `${playerName} claimed ${correctedPOI}.`;
            console.log(`✅ Claim Accepted: ${claimMessage}`);
            await sendServerMessage(claimMessage);

            setTimeout(() => {
                delete CLAIMS[correctedPOI];
                console.log(`🕒 POI Reset: ${correctedPOI} is now available again.`);
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
