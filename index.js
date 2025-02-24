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

// 🛠 Common Abbreviations for Easier Matching
const PARTIAL_POI_MAP = {
    "svet": "Svetloyarsk Raider Outpost T1",
    "svet raider": "Svetloyarsk Raider Outpost T1",
    "tisy": "Tisy Power Plant T4",
    "kamensk": "Kamensk Heli Depot T3",
    "kamensk heli": "Kamensk Heli Depot T3",
    "elektro": "Elektro Radier Outpost T1",
    "klyuch": "Klyuch Military T2",
    "rog": "Rog Castle Military T2",
    "zub": "Zub Castle Military T3",
    "oil rig": "Svetloyarsk Oil Rig T4",
    "balota": "Balota Warehouse T1",
    "heli": "Heli Crash (Active Now)",
    "airdrop": "Airdrop (Active Now)",
    "hunter": "Hunter Camp (Active Now)",
    "knight": "Knight (Quest)",
    "banker": "Banker (Quest)"
};

/**
 * Finds the closest matching POI from input.
 */
function findMatchingPOI(input) {
    let normalizedPOI = input.trim().toLowerCase().replace(/\s+/g, " ");

    // 🟢 First check direct mappings
    let correctedPOI = PARTIAL_POI_MAP[normalizedPOI] || POI_MAP[normalizedPOI];

    // 🔎 If no match, try fuzzy matching
    if (!correctedPOI) {
        let bestMatch = stringSimilarity.findBestMatch(
            normalizedPOI,
            [...Object.keys(POI_MAP), ...Object.values(POI_MAP), ...Object.keys(PARTIAL_POI_MAP), ...Object.values(PARTIAL_POI_MAP)]
        );

        if (bestMatch.bestMatch.rating >= 0.6) {  // Lowered from 0.8 to 0.6
            correctedPOI = PARTIAL_POI_MAP[bestMatch.bestMatch.target] || POI_MAP[bestMatch.bestMatch.target] || bestMatch.bestMatch.target;
        }
    }

    return correctedPOI;
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

    if (eventType !== "user.chat") {
        return res.sendStatus(204);
    }

    const messageContent = eventData.message.toLowerCase();
    const playerName = eventData.player_name;

    // 🟢 "Check Claims" command
    if (CHECK_CLAIMS_REGEX.test(messageContent)) {
        let availablePOIs = Object.keys(POI_MAP).filter(poi => !CLAIMS[poi] && !EXCLUDED_POIS.includes(poi));

        if (availablePOIs.length === 0) {
            await sendServerMessage("All POIs are currently claimed.");
        } else {
            let availableList = availablePOIs.map(poi => POI_MAP[poi]).join(", ");
            await sendServerMessage(`Available POIs: ${availableList}`);
        }
        return res.sendStatus(204);
    }

    // 🟢 "Claim POI" command
    const claimMatch = messageContent.match(CLAIM_REGEX);
    if (claimMatch) {
        let correctedPOI = findMatchingPOI(claimMatch[1]);

        if (!correctedPOI) {
            await sendServerMessage(`Invalid POI: ${claimMatch[1]}. Try 'check claims' to see available POIs.`);
            return res.sendStatus(204);
        }

        if (CLAIMS[correctedPOI]) {
            await sendServerMessage(`${correctedPOI} was already claimed by ${CLAIMS[correctedPOI].player}.`);
            return res.sendStatus(204);
        }

        CLAIMS[correctedPOI] = { player: playerName, timestamp: Date.now() };
        await sendServerMessage(`${playerName} claimed ${correctedPOI}.`);
        return res.sendStatus(204);
    }

    // 🟢 "Unclaim POI" command
    const unclaimMatch = messageContent.match(UNCLAIM_REGEX);
    if (unclaimMatch) {
        let correctedPOI = findMatchingPOI(unclaimMatch[1]);

        if (!correctedPOI || !CLAIMS[correctedPOI]) {
            await sendServerMessage(`${correctedPOI || unclaimMatch[1]} is not currently claimed.`);
            return res.sendStatus(204);
        }

        if (CLAIMS[correctedPOI].player !== playerName) {
            await sendServerMessage(`You cannot unclaim ${correctedPOI}. It was claimed by ${CLAIMS[correctedPOI].player}.`);
            return res.sendStatus(204);
        }

        delete CLAIMS[correctedPOI];
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
