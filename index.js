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

// 🟢 Command Regex
const CLAIM_REGEX = /\bclaim\s+([A-Za-z0-9_ -]+)\b/i;
const UNCLAIM_REGEX = /\bunclaim\s+([A-Za-z0-9_ -]+)\b/i;
const CHECK_CLAIMS_REGEX = /\bcheck claims\b/i;
const CHECK_POI_REGEX = /\bcheck\s+([A-Za-z0-9_ -]+)\b/i;

// 🛑 POIs that should NOT be listed in "Check Claims"
const EXCLUDED_POIS = [
    "Heli Crash (Active Now)",
    "Hunter Camp (Active Now)",
    "Airdrop (Active Now)"
];

// 🟢 POI LIST with Abbreviations
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
    "Balota Warehouse T1": "Balota"
};

// 🔄 Reverse Lookup Map (Abbreviated → Full POI Name)
const ABBREVIATED_TO_FULL_POI = Object.fromEntries(
    Object.entries(POI_MAP).map(([full, short]) => [short.toLowerCase(), full])
);

// 🔄 Lowercase POI List for Fuzzy Matching
const POI_ABBREVIATIONS_LOWER = Object.values(POI_MAP).map(poi => poi.toLowerCase());

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

    // 🟢 "Check Claims" command
    if (CHECK_CLAIMS_REGEX.test(messageContent)) {
        let availablePOIs = Object.keys(POI_MAP).filter(poi => !CLAIMS[poi] && !EXCLUDED_POIS.includes(poi));

        if (availablePOIs.length === 0) {
            await sendServerMessage("All POIs are currently claimed.");
        } else {
            let formattedPOIs = availablePOIs.map(poi => POI_MAP[poi]);
            let availableList = formattedPOIs.join(", ");

            await sendServerMessage(`Available POIs: ${availableList}`);
        }
        return res.sendStatus(204);
    }

    // 🟢 "Check POI" command
    const checkMatch = messageContent.match(CHECK_POI_REGEX);
    if (checkMatch) {
        let detectedPOI = checkMatch[1].trim().toLowerCase();
        let correctedPOI = ABBREVIATED_TO_FULL_POI[detectedPOI];

        if (!correctedPOI) {
            let bestMatch = stringSimilarity.findBestMatch(detectedPOI, POI_ABBREVIATIONS_LOWER);
            if (bestMatch.bestMatch.rating > 0.5) {
                correctedPOI = Object.keys(POI_MAP).find(key => POI_MAP[key].toLowerCase() === bestMatch.bestMatch.target);
            }
        }

        if (!correctedPOI) {
            console.log(`❌ Unknown POI Check: ${playerName} attempted to check '${detectedPOI}'`);
            await sendServerMessage(`Unknown POI: ${detectedPOI}. Try 'check claims' to see available POIs.`);
            return res.sendStatus(204);
        }

        if (CLAIMS[correctedPOI]) {
            let timeSinceClaim = Math.floor((Date.now() - CLAIMS[correctedPOI].timestamp) / 60000);
            let claimMessage = `${POI_MAP[correctedPOI]} is claimed by ${CLAIMS[correctedPOI].player} ${timeSinceClaim} minutes ago.`;
            console.log(`🔍 POI Check: ${claimMessage}`);
            await sendServerMessage(claimMessage);
        } else {
            console.log(`🔍 POI Check: ${POI_MAP[correctedPOI]} is available.`);
            await sendServerMessage(`${POI_MAP[correctedPOI]} is available to claim!`);
        }
        return res.sendStatus(204);
    }

    // 🟢 "Claim POI" command
    const claimMatch = messageContent.match(CLAIM_REGEX);
    if (claimMatch) {
        let detectedPOI = claimMatch[1].trim().toLowerCase();
        let correctedPOI = ABBREVIATED_TO_FULL_POI[detectedPOI];

        if (!correctedPOI || CLAIMS[correctedPOI]) {
            console.log(`❌ Invalid or already claimed POI: ${detectedPOI}`);
            return res.sendStatus(204);
        }

        CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
        let claimMessage = `${playerName} claimed ${POI_MAP[correctedPOI]}.`;
        console.log(`✅ Claim Accepted: ${claimMessage}`);
        await sendServerMessage(claimMessage);

        return res.sendStatus(204);
    }

    // 🟢 "Unclaim POI" command
    const unclaimMatch = messageContent.match(UNCLAIM_REGEX);
    if (unclaimMatch) {
        let detectedPOI = unclaimMatch[1].trim().toLowerCase();
        let correctedPOI = ABBREVIATED_TO_FULL_POI[detectedPOI];

        if (!correctedPOI || !CLAIMS[correctedPOI] || CLAIMS[correctedPOI].player !== playerName) {
            return res.sendStatus(204);
        }

        delete CLAIMS[correctedPOI];
        await sendServerMessage(`${playerName} unclaimed ${POI_MAP[correctedPOI]}.`);
        return res.sendStatus(204);
    }

    res.sendStatus(204);
});

/**
 * Start the Express server
 */
app.listen(PORT, () => {
    console.log(`🚀 Webhook Server listening on port ${PORT}`);
});
