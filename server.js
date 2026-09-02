require('dotenv').config();

const express = require('express');
const https = require('https');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true
});

let cachedBuses = [];
let lastUpdate = null;

// ==================== TUBE NETWORK ====================

const elizabethLine = 'elizabeth';

const tubeLines = [
    'bakerloo',
    'central',
    'circle',
    'district',
    'hammersmith-city',
    'jubilee',
    'metropolitan',
    'northern',
    'piccadilly',
    'victoria',
    'waterloo-city'
];

let cachedTube = null;
let tubeLastUpdate = null;

let cachedElizabeth = null;
let elizabethLastUpdate = null;

function fetchTflJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            let data = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                if (response.statusCode !== 200) {
                    return reject(
                        new Error(`TfL returned HTTP ${response.statusCode}`)
                    );
                }

                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(new Error('Invalid JSON returned by TfL'));
                }
            });
        }).on('error', reject);
    });
}

async function updateTube() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const results = await Promise.all(
            tubeLines.map(async lineId => {
                const [route, status] = await Promise.all([
                    fetchTflJson(
                        `https://api.tfl.gov.uk/Line/${lineId}/Route/Sequence/all?app_key=${encodeURIComponent(key)}`
                    ),
                    fetchTflJson(
                        `https://api.tfl.gov.uk/Line/${lineId}/Status?app_key=${encodeURIComponent(key)}`
                    )
                ]);

                return {
                    id: lineId,
                    name: route.lineName,
                    mode: 'tube',
                    lineStrings: route.lineStrings || [],
                    stations: route.stations || [],
                    status: status[0]?.lineStatuses || []
                };
            })
        );

        cachedTube = results;
        tubeLastUpdate = new Date().toISOString();

        console.log(`Updated Tube network: ${results.length} lines`);
    } catch (error) {
        console.error('TfL Tube update failed:', error.message);
    }
}

async function updateElizabeth() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const [route, status] = await Promise.all([
            fetchTflJson(
                `https://api.tfl.gov.uk/Line/${elizabethLine}/Route/Sequence/all?app_key=${encodeURIComponent(key)}`
            ),
            fetchTflJson(
                `https://api.tfl.gov.uk/Line/${elizabethLine}/Status?app_key=${encodeURIComponent(key)}`
            )
        ]);

        cachedElizabeth = {
            id: elizabethLine,
            name: route.lineName,
            mode: 'elizabeth',
            lineStrings: route.lineStrings || [],
            stations: route.stations || [],
            status: status[0]?.lineStatuses || []
        };

        elizabethLastUpdate = new Date().toISOString();

        console.log(
            `Updated Elizabeth line: ${cachedElizabeth.stations.length} stations`
        );
    } catch (error) {
        console.error(
            'Elizabeth line update failed:',
            error.message
        );
    }
}

function fetchBods() {
    return new Promise((resolve, reject) => {
        const key = process.env.BODS_API_KEY;

        if (!key) {
            return reject(new Error('BODS_API_KEY is missing'));
        }

        const url =
            'https://data.bus-data.dft.gov.uk/api/v1/datafeed/' +
            '?boundingBox=-0.54,51.26,0.27,51.75' +
            '&api_key=' + encodeURIComponent(key);

        https.get(url, response => {
            let data = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                if (response.statusCode !== 200) {
                    return reject(
                        new Error(`BODS returned HTTP ${response.statusCode}`)
                    );
                }

                resolve(data);
            });
        }).on('error', reject);
    });
}

function extractBuses(xml) {
    const parsed = parser.parse(xml);

    const deliveries =
        parsed?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;

    if (!deliveries) {
        return [];
    }

    const delivery = Array.isArray(deliveries)
        ? deliveries[0]
        : deliveries;

    let activities = delivery.VehicleActivity || [];

    if (!Array.isArray(activities)) {
        activities = [activities];
    }

    const buses = [];

    for (const activity of activities) {
        const journey = activity.MonitoredVehicleJourney;
        const location = journey?.VehicleLocation;

        if (!journey || !location) {
            continue;
        }

        const latitude = Number(location.Latitude);
        const longitude = Number(location.Longitude);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            continue;
        }
if (journey.OperatorRef !== 'TFLO') {
    continue;
}
        buses.push({
            vehicleId: journey.VehicleRef || null,
            route: journey.PublishedLineName || journey.LineRef || null,
            lineRef: journey.LineRef || null,
            direction: journey.DirectionRef || null,
            destination: journey.DestinationName || null,
            operator: journey.OperatorRef || null,
            latitude,
            longitude,
            bearing: Number(journey.Bearing) || 0,
            recordedAt: activity.RecordedAtTime || null
        });
    }

    return buses;
}

async function updateBuses() {
    try {
        const xml = await fetchBods();
        cachedBuses = extractBuses(xml);
        lastUpdate = new Date().toISOString();

        console.log(
            `Updated live buses: ${cachedBuses.length} vehicles`
        );
    } catch (error) {
        console.error('BODS update failed:', error.message);
    }
}

app.get('/', (req, res) => {
    res.send('TfL Live Bus Map is running!');
});

app.get('/api/tube', (req, res) => {
    res.json({
        updatedAt: tubeLastUpdate,
        count: cachedTube ? cachedTube.length : 0,
        lines: cachedTube || []
    });
});

app.get('/api/elizabeth', (req, res) => {
    res.json({
        updatedAt: elizabethLastUpdate,
        line: cachedElizabeth
    });
});

// ==================== TUBE TRAIN POSITIONING ====================

function normaliseStationName(name) {
    return name
        .replace(/\s+Underground Station$/i, '')
        .replace(/\s+Station$/i, '')
        .replace(/\s+Platform\s+\d+$/i, '')
        .trim()
        .toLowerCase();
}

function parseLineString(lineString) {
    const parsed = JSON.parse(lineString);

    if (
        Array.isArray(parsed[0]) &&
        Array.isArray(parsed[0][0])
    ) {
        return parsed.flat();
    }

    return parsed;
}

function getTubeLine(lineId) {
    if (!cachedTube) {
        return null;
    }

    return cachedTube.find(line => line.id === lineId) || null;
}

function getStationLookup(line) {
    const lookup = new Map();

    for (const station of line.stations || []) {
        lookup.set(
            normaliseStationName(station.name),
            station
        );
    }

    return lookup;
}

function findNearestGeometryPoint(points, target) {
    let bestIndex = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < points.length; i++) {
        const dx = points[i][0] - target[0];
        const dy = points[i][1] - target[1];
        const distance = dx * dx + dy * dy;

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    return bestIndex;
}

function findGeometrySection(line, stationA, stationB) {
    const targetA = [stationA.lon, stationA.lat];
    const targetB = [stationB.lon, stationB.lat];

    let bestSection = null;

    for (const lineString of line.lineStrings || []) {
        const points = parseLineString(lineString);

        if (points.length < 2) {
            continue;
        }

        const indexA = findNearestGeometryPoint(points, targetA);
        const indexB = findNearestGeometryPoint(points, targetB);

        if (indexA === -1 || indexB === -1) {
            continue;
        }

        const nearestA = points[indexA];
        const nearestB = points[indexB];

        const distanceA =
            Math.sqrt(
                (nearestA[0] - targetA[0]) ** 2 +
                (nearestA[1] - targetA[1]) ** 2
            );

        const distanceB =
            Math.sqrt(
                (nearestB[0] - targetB[0]) ** 2 +
                (nearestB[1] - targetB[1]) ** 2
            );

        // Reject geometry that does not genuinely contain
        // both stations. This prevents unrelated route branches
        // from being selected.
        if (distanceA > 0.003 || distanceB > 0.003) {
            continue;
        }

        const sectionLength = Math.abs(indexA - indexB);

        if (!bestSection || sectionLength < bestSection.length) {
            bestSection = {
                points,
                indexA,
                indexB,
                length: sectionLength
            };
        }
    }

    if (!bestSection) {
        return null;
    }

    const start = Math.min(
        bestSection.indexA,
        bestSection.indexB
    );

    const end = Math.max(
        bestSection.indexA,
        bestSection.indexB
    );

    return bestSection.points.slice(start, end + 1);
}

function midpointOfGeometry(points) {
    if (!points || points.length === 0) {
        return null;
    }

    if (points.length === 1) {
        return {
            lat: points[0][1],
            lon: points[0][0]
        };
    }

    const first = points[0];
    const last = points[points.length - 1];

    return {
        lat: (first[1] + last[1]) / 2,
        lon: (first[0] + last[0]) / 2
    };
}

function getTubeTrainPosition(train) {
    const line = getTubeLine(train.lineId);

    if (!line) {
        return null;
    }

    const location = (train.currentLocation || '').trim();

    if (!location) {
        return null;
    }

    const stations = getStationLookup(line);

    function stationPosition(stationName, positionType) {
        const station = stations.get(
            normaliseStationName(stationName)
        );

        if (!station) {
            return null;
        }

        return {
            lat: station.lat,
            lon: station.lon,
            positionType
        };
    }

    // TfL sometimes reports simply "At Platform".
    // In that case, stationName from the arrival prediction
    // identifies the station.
    if (/^At Platform(?:\s+\d+)?$/i.test(location)) {
        return stationPosition(
            train.stationName || '',
            'station'
        );
    }

    // At a named station.
    if (location.startsWith('At ')) {
        const stationName = location
            .replace(/^At\s+/i, '')
            .replace(/\s+Platform\s+\d+$/i, '')
            .trim();

        // Do not guess for sidings, crossovers or other
        // operational locations.
        if (
            /sidings?/i.test(stationName) ||
            /crossover/i.test(stationName)
        ) {
            return null;
        }

        if (/^Platform(?:\s+\d+)?$/i.test(stationName)) {
            return stationPosition(
                train.stationName || '',
                'station'
            );
        }

        return stationPosition(stationName, 'station');
    }

    // Between two named stations.
    const betweenMatch = location.match(
        /^Between\s+(.+?)\s+and\s+(.+)$/i
    );

    if (betweenMatch) {
        const stationA = stations.get(
            normaliseStationName(betweenMatch[1])
        );

        const stationB = stations.get(
            normaliseStationName(betweenMatch[2])
        );

        if (!stationA || !stationB) {
            return null;
        }

        const section = findGeometrySection(
            line,
            stationA,
            stationB
        );

        const position = midpointOfGeometry(section);

        if (!position) {
            return null;
        }

        return {
            ...position,
            positionType: 'between',
            between: [
                stationA.name,
                stationB.name
            ]
        };
    }

    // Approaching a station.
    const approachingMatch = location.match(
        /^Approaching\s+(.+)$/i
    );

    if (approachingMatch) {
        const stationName = approachingMatch[1]
            .replace(/\s+Platform\s+\d+$/i, '')
            .trim();

        return stationPosition(
            stationName,
            'approaching'
        );
    }

    // Leaving a station.
    const leavingMatch = location.match(
        /^Leaving\s+(.+)$/i
    );

    if (leavingMatch) {
        const stationName = leavingMatch[1]
            .replace(/\s+Platform\s*$/i, '')
            .trim();

        return stationPosition(
            stationName,
            'leaving'
        );
    }

    // Departed a station.
    const departedMatch = location.match(
        /^Departed\s+(.+)$/i
    );

    if (departedMatch) {
        const stationName = departedMatch[1]
            .replace(/\s+Platform\s+\d+$/i, '')
            .replace(/\s+Platform$/i, '')
            .trim();

        return stationPosition(
            stationName,
            'departed'
        );
    }

    // Arriving at a station.
    const arrivingMatch = location.match(
        /^Arriving\s+At\s+(.+)$/i
    );

    if (arrivingMatch) {
        const stationName = arrivingMatch[1]
            .replace(/\s+Platform\s+\d+$/i, '')
            .trim();

        return stationPosition(
            stationName,
            'approaching'
        );
    }

    return null;
}


function addTrainPositions(trains) {
    return trains.map(train => {
        const position =
            getTubeTrainPosition(train);

        return {
            ...train,
            position
        };
    });
}

// ==================== LIVE TUBE TRAINS ====================

let cachedTubeTrains = [];
let tubeTrainsLastUpdate = null;

async function updateTubeTrains() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const lines = [
            'bakerloo',
            'central',
            'circle',
            'district',
            'hammersmith-city',
            'jubilee',
            'metropolitan',
            'northern',
            'piccadilly',
            'victoria',
            'waterloo-city'
        ];

        const results = [];

        for (const lineId of lines) {
            const url =
                `https://api.tfl.gov.uk/Line/${lineId}/Arrivals?app_key=${encodeURIComponent(key)}`;

            try {
                const arrivals = await fetchTflJson(url);

                results.push(...arrivals);
            } catch (error) {
                console.error(
                    `Tube arrivals ${lineId} failed:`,
                    error.message
                );
            }
        }

        const vehicles = new Map();

        for (const arrival of results) {
            if (!arrival.vehicleId) {
                continue;
            }

            const vehicleId = arrival.vehicleId;
            const existing = vehicles.get(vehicleId);

            if (!existing) {
                vehicles.set(vehicleId, arrival);
                continue;
            }

            const existingTime =
                Number.isFinite(existing.timeToStation)
                    ? existing.timeToStation
                    : Infinity;

            const arrivalTime =
                Number.isFinite(arrival.timeToStation)
                    ? arrival.timeToStation
                    : Infinity;

            if (arrivalTime < existingTime) {
                vehicles.set(vehicleId, arrival);
            }
        }

        cachedTubeTrains = Array.from(vehicles.values());
        tubeTrainsLastUpdate = new Date().toISOString();

        console.log(
            `Updated live Tube trains: ${cachedTubeTrains.length} vehicles`
        );
    } catch (error) {
        console.error('Tube train update failed:', error.message);
    }
}

app.get('/api/tube-trains', (req, res) => {
    const trainsWithPositions =
        addTrainPositions(cachedTubeTrains);

    res.json({
        updatedAt: tubeTrainsLastUpdate,
        count: trainsWithPositions.length,
        trains: trainsWithPositions
    });
});

app.get('/api/bods/status', (req, res) => {
    res.json({
        status: 'online',
        liveBuses: cachedBuses.length,
        lastUpdate
    });
});

app.get('/api/live-buses', (req, res) => {
    res.json({
        updatedAt: lastUpdate,
        count: cachedBuses.length,
        buses: cachedBuses
    });
});

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);

    await updateBuses();
    await updateTube();
    await updateElizabeth();
    await updateTubeTrains();
    setInterval(updateBuses, 15000);
    setInterval(updateTube, 60000);
    setInterval(updateTubeTrains, 30000);
});
