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
const CLAIM_TIMEOUT = 60 * 60 * 1000; // 60 minutes in milliseconds

// 🟢 Command Regex
const CLAIM_REGEX = /\bclaim\s+([A-Za-z0-9_ -]+)\b/i;
const UNCLAIM_REGEX = /\bunclaim\s+([A-Za-z0-9_ -]+)\b/i;
const CHECK_CLAIMS_REGEX = /\bcheck claims\b/i;
const CHECK_POI_REGEX = /\bcheck\s+([A-Za-z0-9_ -]+)\b/i;

// 🛑 POIs that should NOT be listed in "Check Claims"
const EXCLUDED_POIS = [];

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
    "Balota Warehouse T1": "Balota",
    "Heli Crash (Active Now)" : "Heli",
    "Hunter Camp (Active Now)" : "Hunter",
    "Airdrop (Active Now)" : "Airdrop",
    "Knight (Quest)" : "Knight",
    "Banker (Quest)" : "Banker"
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
 * Automatically release expired POIs after 60 minutes
 */
function releaseExpiredPOIs() {
    const now = Date.now();

    Object.keys(CLAIMS).forEach(poi => {
        if (CLAIMS[poi] && CLAIMS[poi].timestamp && now - CLAIMS[poi].timestamp >= CLAIM_TIMEOUT) {
            console.log(`⏳ Auto-Releasing POI: ${poi} (Claim expired)`);
            delete CLAIMS[poi];
            sendServerMessage(`The claim on ${poi} has expired and is now available.`)
                .then(() => console.log(`✅ Message sent for expired claim: ${poi}`))
                .catch(err => console.error(`❌ Failed to send message for expired claim: ${poi}`, err));

            return; // Prevents further iterations on a deleted claim
        }
    });
}

// Run the auto-release check **every minute**
setInterval(releaseExpiredPOIs, 60 * 1000);

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

        let correctedPOI = Object.keys(POI_MAP).find(key => 
            key.toLowerCase() === detectedPOI || POI_MAP[key].toLowerCase() === detectedPOI
        ) || EXCLUDED_POIS.find(poi => poi.toLowerCase() === detectedPOI);

        // 🔎 Try fuzzy matching if no exact match (Threshold: 0.8)
        if (!correctedPOI) {
            let bestMatch = stringSimilarity.findBestMatch(
                detectedPOI,
                [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...EXCLUDED_POIS].map(poi => poi.toLowerCase())
            );

            if (bestMatch.bestMatch.rating >= 0.8) {
                correctedPOI = [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...EXCLUDED_POIS].find(
                    key => key.toLowerCase() === bestMatch.bestMatch.target
                );
            }
        }

        if (!correctedPOI) {
            console.log(`❌ Unknown POI Check: ${playerName} attempted to check '${detectedPOI}'`);
            await sendServerMessage(`Unknown POI: ${detectedPOI}. Try 'check claims' to see available POIs.`);
            return res.sendStatus(204);
        }

        let storedPOI = Object.keys(POI_MAP).find(key => POI_MAP[key] === correctedPOI) || correctedPOI;

        if (CLAIMS[storedPOI]) {
            let timeSinceClaim = Math.floor((Date.now() - CLAIMS[storedPOI].timestamp) / 60000);
            let claimMessage = `${storedPOI} is claimed by ${CLAIMS[storedPOI].player} ${timeSinceClaim} minutes ago.`;
            console.log(`🔍 POI Check: ${claimMessage}`);
            await sendServerMessage(claimMessage);
        } else {
            console.log(`🔍 POI Check: ${storedPOI} is available.`);
            await sendServerMessage(`${storedPOI} is available to claim!`);
        }
        return res.sendStatus(204);
    }

    // 🟢 "Claim POI" command
    const claimMatch = messageContent.match(CLAIM_REGEX);
    if (claimMatch) {
        let detectedPOI = claimMatch[1].trim().toLowerCase();

        // 🔍 Find exact match in POI_MAP or EXCLUDED_POIS
        let correctedPOI = Object.keys(POI_MAP).find(key => 
            key.toLowerCase() === detectedPOI || POI_MAP[key].toLowerCase() === detectedPOI
        ) || EXCLUDED_POIS.find(poi => poi.toLowerCase() === detectedPOI);

        // 🔎 If no exact match, try fuzzy matching (Threshold: 0.8 or higher)
        if (!correctedPOI) {
            let bestMatch = stringSimilarity.findBestMatch(
                detectedPOI,
                [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...EXCLUDED_POIS].map(poi => poi.toLowerCase())
            );

            if (bestMatch.bestMatch.rating >= 0.8) {
                correctedPOI = [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...EXCLUDED_POIS].find(
                    key => key.toLowerCase() === bestMatch.bestMatch.target
                );
            }
        }

        // ❌ If no valid match, reject the claim
        if (!correctedPOI) {
            console.log(`❌ Invalid Claim: ${playerName} attempted to claim an unknown POI: ${detectedPOI}`);
            await sendServerMessage(`Invalid POI: ${detectedPOI}. Try 'check claims' to see available POIs.`);
            return res.sendStatus(204);
        }

        // 🛠 Ensure we use the full name from POI_MAP or EXCLUDED_POIS
        let storedPOI = Object.keys(POI_MAP).find(key => POI_MAP[key] === correctedPOI) || correctedPOI;

        // 🚫 Check if the POI is already claimed
        if (CLAIMS[storedPOI]) {
            let timeSinceClaim = Math.floor((Date.now() - CLAIMS[storedPOI].timestamp) / 60000);
            let responseMessage = `${storedPOI} was already claimed by ${CLAIMS[storedPOI].player} ${timeSinceClaim} minutes ago.`;
            console.log(`🚫 POI Already Claimed: ${responseMessage}`);
            await sendServerMessage(responseMessage);
            return res.sendStatus(204);
        }

        // ✅ Claim the POI (Store using FULL POI name)
        CLAIMS[storedPOI] = { player: playerName, timestamp: Date.now() };
        let claimMessage = `${playerName} claimed ${storedPOI}.`;
        console.log(`✅ Claim Accepted: ${claimMessage}`);
        await sendServerMessage(claimMessage);
        return res.sendStatus(204);
    }

    // 🟢 "Unclaim POI" command
    const unclaimMatch = messageContent.match(UNCLAIM_REGEX);
    if (unclaimMatch) {
        let detectedPOI = unclaimMatch[1].trim().toLowerCase();

        // 🔍 Find full POI name (ensure stored key matches)
        let correctedPOI = Object.entries(POI_MAP).find(([full, short]) => 
            short.toLowerCase() === detectedPOI || full.toLowerCase() === detectedPOI
        )?.[0] || EXCLUDED_POIS.find(poi => poi.toLowerCase() === detectedPOI);

        // ❌ If no match, fail the unclaim
        if (!correctedPOI || !CLAIMS[correctedPOI]) {
            console.log(`❌ Unclaim Failed: ${correctedPOI || detectedPOI} is not currently claimed.`);
            await sendServerMessage(`${correctedPOI || detectedPOI} is not currently claimed.`);
            return res.sendStatus(204);
        }

        // 🚫 Prevent unclaiming by non-owners
        if (CLAIMS[correctedPOI].player !== playerName) {
            console.log(`❌ Unclaim Failed: ${playerName} tried to unclaim ${correctedPOI}, but it was claimed by ${CLAIMS[correctedPOI].player}.`);
            await sendServerMessage(`You cannot unclaim ${correctedPOI}. It was claimed by ${CLAIMS[correctedPOI].player}.`);
            return res.sendStatus(204);
        }

        // ✅ Unclaim the POI
        delete CLAIMS[correctedPOI];
        console.log(`✅ POI Unclaimed: ${playerName} successfully unclaimed ${correctedPOI}`);
        await sendServerMessage(`${playerName} unclaimed ${correctedPOI}.`);
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
