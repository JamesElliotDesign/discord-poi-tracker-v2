const axios = require("axios");
require("dotenv").config();

const API_BASE_URL = "https://data.cftools.cloud/v1";
const APPLICATION_ID = process.env.CFTOOLS_APPLICATION_ID;
const APPLICATION_SECRET = process.env.CFTOOLS_APPLICATION_SECRET;
const SERVER_API_ID = process.env.CFTOOLS_SERVER_API_ID;

let authToken = null;
let tokenExpiration = 0;

// ✅ Predefined POI Positions
const POI_POSITIONS = {
    "Sinystok Bunker T5": [1190.4285, 387.8023, 12374.2656],
    "Yephbin Underground Facility T4": [977.6797, 347.3488, 10234.9707],
    "Rostoki Castle T5": [495.5739, 207.4658, 8533.7031],
    "Svetloyarsk Oil Rig T4": [15029.0967, 1.1094, 12761.8027],
    "Elektro Radier Outpost T1": [9994.9443, 6.0224, 1648.2579],
    "Tracksuit Tower T1": [5794.2934, 65.2890, 2483.3896],
    "Otmel Raider Outpost T1": [11580.1377, 1.9841, 3151.4504],
    "Svetloyarsk Raider Outpost T1": [14348.5381, 3.3648, 13189.7441],
    "Solenchny Raider Outpost T1": [13582.8535, 3.0000, 6355.3173],
    "Klyuch Military T2": [9289.1669, 107.2970, 13500.7099],
    "Rog Castle Military T2": [11252.0703, 290.9022, 4291.7099],
    "Zub Castle Military T3": [6529.2939, 387.5570, 5597.5400],
    "Kamensk Heli Depot T3": [7098.5141, 356.1524, 14602.9316],
    "Tisy Power Plant T4": [577.2073, 501.8031, 13668.6054],
    "Krasno Warehouse T2": [11868.5332, 140.0946, 12436.2246],
    "Balota Warehouse T1": [4941.2353, 9.5147, 2430.8066]
};

/**
 * Authenticate with CFTools API
 */
async function authenticate() {
    try {
        const response = await axios.post(`${API_BASE_URL}/auth/register`, {
            application_id: APPLICATION_ID,
            secret: APPLICATION_SECRET,
        }, {
            headers: { "User-Agent": APPLICATION_ID },
        });

        authToken = response.data.token;
        tokenExpiration = Date.now() + 24 * 60 * 60 * 1000;
        console.log("✅ Successfully authenticated with CFTools API");
    } catch (error) {
        console.error("❌ CFTools Authentication Failed:", error.response?.data || error.message);
        throw new Error("Failed to authenticate with CFTools API");
    }
}

/**
 * Get Player Position from CFTools API
 */
async function getPlayerPosition(playerName) {
    try {
        if (!authToken || Date.now() >= tokenExpiration) await authenticate();

        const response = await axios.get(`${API_BASE_URL}/server/${SERVER_API_ID}/GSM/list`, {
            headers: {
                "Authorization": `Bearer ${authToken}`,
                "User-Agent": APPLICATION_ID,
            },
        });

        console.log("🔍 Raw API Response:", JSON.stringify(response.data, null, 2));

        // ✅ FIX: Use "sessions" array instead of "players"
        const players = response.data.sessions || [];
        console.log("🔍 Players Retrieved from API:", players.map(p => p.gamedata.player_name)); 

        const player = players.find(p => {
            if (!p.gamedata || !p.gamedata.player_name) return false;

            // Trim & normalize for accurate comparison
            const apiName = p.gamedata.player_name.trim().toLowerCase();
            const inputName = playerName.trim().toLowerCase();

            console.log(`🔍 Checking Player: '${apiName}' vs '${inputName}'`);

            return apiName === inputName;
        });

        if (!player) {
            console.log(`❌ Player '${playerName}' not found in API response.`);
            return null;
        }

        if (!player.live || !player.live.position || !player.live.position.latest) {
            console.log(`❌ Player '${playerName}' found, but no valid latest position data.`);
            console.log("🔍 Full Player Data:", JSON.stringify(player, null, 2));
            return null;
        }

        return player.live.position.latest; // ✅ Fetch latest position correctly

    } catch (error) {
        console.error("❌ Failed to fetch player position:", error.response?.data || error.message);
        return null;
    }
}

/**
 * Calculate Distance between two positions
 */
function calculateDistance(pos1, pos2) {
    // ✅ Fix coordinate order
    const x1 = pos1[0];
    const z1 = pos1[1]; // 🔹 Fix: Use [1] instead of [2]

    const x2 = pos2[0];
    const z2 = pos2[1]; // 🔹 Fix: Use [1] instead of [2]

    const dx = x1 - x2;
    const dz = z1 - z2;

    const distance = Math.sqrt(dx * dx + dz * dz);
    console.log(`📏 Calculated Distance: ${distance.toFixed(2)}m (Ignoring Y-axis)`);
    
    return distance;
}

/**
 * Validate if Player is within 500m of POI
 */
async function isPlayerNearPOI(playerName, poiName) {
    const playerPos = await getPlayerPosition(playerName);
    if (!playerPos) return { success: false, message: `Unable to retrieve position for ${playerName}.` };

    const poiPos = POI_POSITIONS[poiName];
    if (!poiPos) return { success: false, message: `Unknown POI: ${poiName}.` };

    const distance = calculateDistance(playerPos, poiPos);
    console.log(`📍 ${playerName} Distance to ${poiName}: ${distance.toFixed(2)}m`);

    if (distance <= 500) {
        return { success: true, message: `${playerName} is within range of ${poiName}.` };
    } else {
        return { success: false, message: `${playerName} is too far from ${poiName} (${distance.toFixed(2)}m). Move closer to claim.` };
    }
}

module.exports = { isPlayerNearPOI };
