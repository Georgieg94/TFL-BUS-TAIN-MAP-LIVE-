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
let cachedTram = null;
let tramLastUpdate = null;

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

async function updateTram() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const [route, status] = await Promise.all([
            fetchTflJson(
                `https://api.tfl.gov.uk/Line/tram/Route/Sequence/all?app_key=${encodeURIComponent(key)}`
            ),
            fetchTflJson(
                `https://api.tfl.gov.uk/Line/tram/Status?app_key=${encodeURIComponent(key)}`
            )
        ]);

        cachedTram = {
            id: 'tram',
            name: route.lineName,
            mode: 'tram',
            lineStrings: route.lineStrings || [],
            stations: route.stations || [],
            status: status[0]?.lineStatuses || []
        };

        tramLastUpdate = new Date().toISOString();

        console.log(
            `Updated Tram network: ${cachedTram.stations.length} stops`
        );
    } catch (error) {
        console.error(
            'Tram network update failed:',
            error.message
        );
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

app.get('/api/tram', (req, res) => {
    res.json({
        updatedAt: tramLastUpdate,
        line: cachedTram
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



function getElizabethLine() {
    return cachedElizabeth || null;
}

function getElizabethRouteVariants() {
    const line = getElizabethLine();

    if (!line) {
        return [];
    }

    const stations = getStationLookup(line);
    const variants = [];

    for (const lineString of line.lineStrings || []) {
        const points = parseLineString(lineString);

        if (!points || points.length < 2) {
            continue;
        }

        const stationMatches = [];

        for (let i = 0; i < points.length; i++) {
            let bestStation = null;
            let bestDistance = Infinity;

            for (const station of line.stations || []) {
                const dx = points[i][0] - station.lon;
                const dy = points[i][1] - station.lat;
                const distance = dx * dx + dy * dy;

                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestStation = station;
                }
            }

            if (
                bestStation &&
                bestDistance <= 0.01
            ) {
                const key =
                    normaliseStationName(bestStation.name);

                if (
                    !stationMatches.length ||
                    stationMatches[stationMatches.length - 1].key !== key
                ) {
                    stationMatches.push({
                        key,
                        station: bestStation,
                        pointIndex: i
                    });
                }
            }
        }

        if (stationMatches.length < 2) {
            continue;
        }

        variants.push({
            points,
            stations: stationMatches
        });
    }

    return variants;
}

function findElizabethRouteForTrain(
    train,
    uniquePredictions,
    variants
) {
    const destinationKey =
        normaliseStationName(
            train.predictions?.[0]?.destinationName || ''
        );

    const predictedKeys =
        new Set(
            uniquePredictions.map(
                prediction => prediction.stationKey
            )
        );

    let bestVariant = null;
    let bestScore = -Infinity;

    for (const variant of variants) {
        const routeKeys =
            new Set(
                variant.stations.map(
                    station => station.key
                )
            );

        let score = 0;

        if (
            destinationKey &&
            routeKeys.has(destinationKey)
        ) {
            score += 100;
        }

        for (const key of predictedKeys) {
            if (routeKeys.has(key)) {
                score += 10;
            }
        }

        if (score > bestScore) {
            bestScore = score;
            bestVariant = variant;
        }
    }

    return bestVariant;
}

function getElizabethTrainPosition(train) {
    const line = getElizabethLine();

    if (!line) {
        return null;
    }

    const predictions = Array.isArray(train.predictions)
        ? train.predictions
        : [];

    if (predictions.length === 0) {
        return null;
    }

    const stations = getStationLookup(line);

    /*
     * Collapse TfL's duplicate names for the same physical
     * station, keeping the earliest prediction.
     */
    const predictionByStation = new Map();

    for (const prediction of predictions) {
        const stationKey =
            normaliseStationName(
                prediction.stationName || ''
            );

        if (!stationKey) {
            continue;
        }

        const station = stations.get(stationKey);

        if (!station) {
            continue;
        }

        const timeToStation =
            Number(prediction.timeToStation);

        if (!Number.isFinite(timeToStation)) {
            continue;
        }

        const existing =
            predictionByStation.get(stationKey);

        if (
            !existing ||
            timeToStation < existing.timeToStation
        ) {
            predictionByStation.set(
                stationKey,
                {
                    ...prediction,
                    station,
                    stationKey,
                    timeToStation
                }
            );
        }
    }

    const uniquePredictions =
        Array.from(
            predictionByStation.values()
        ).sort(
            (a, b) =>
                a.timeToStation -
                b.timeToStation
        );

    if (!uniquePredictions.length) {
        return null;
    }

    const variants =
        getElizabethRouteVariants();

    if (!variants.length) {
        return null;
    }

    const route =
        findElizabethRouteForTrain(
            train,
            uniquePredictions,
            variants
        );

    if (!route) {
        return null;
    }

    const routeIndex = new Map();

    route.stations.forEach(
        (station, index) => {
            routeIndex.set(
                station.key,
                {
                    ...station,
                    routeIndex: index
                }
            );
        }
    );

    const nextPrediction =
        uniquePredictions[0];

    const nextRouteStation =
        routeIndex.get(
            nextPrediction.stationKey
        );

    if (!nextRouteStation) {
        return null;
    }

    /*
     * A terminal prediction with no meaningful following
     * station is safest represented at the terminal.
     */
    if (uniquePredictions.length === 1) {
        return {
            lat: nextPrediction.station.lat,
            lon: nextPrediction.station.lon,
            positionType: 'station',
            station: nextPrediction.station.name
        };
    }

    /*
     * Find the next predicted station that occurs after
     * the current predicted station on this specific route.
     */
    let followingPrediction = null;

    for (const prediction of uniquePredictions.slice(1)) {
        const candidate =
            routeIndex.get(
                prediction.stationKey
            );

        if (
            candidate &&
            candidate.routeIndex >
                nextRouteStation.routeIndex
        ) {
            followingPrediction = prediction;
            break;
        }
    }

    /*
     * If the train is at/near a station, use that station.
     */
    if (nextPrediction.timeToStation <= 15) {
        return {
            lat: nextPrediction.station.lat,
            lon: nextPrediction.station.lon,
            positionType: 'station',
            station: nextPrediction.station.name
        };
    }

    /*
     * Find the station immediately before the next predicted
     * station on the selected route. This is the current section.
     */
    const previousRouteStation =
        route.stations[
            nextRouteStation.routeIndex - 1
        ];

    if (!previousRouteStation) {
        return {
            lat: nextPrediction.station.lat,
            lon: nextPrediction.station.lon,
            positionType: 'station',
            station: nextPrediction.station.name
        };
    }

    const startIndex =
        previousRouteStation.pointIndex;

    const endIndex =
        nextRouteStation.pointIndex;

    const start =
        Math.min(startIndex, endIndex);

    const end =
        Math.max(startIndex, endIndex);

    const section =
        route.points.slice(
            start,
            end + 1
        );

    if (section.length < 2) {
        return null;
    }

    let progress = 0;

    if (
        followingPrediction &&
        followingPrediction.timeToStation >
            nextPrediction.timeToStation
    ) {
        const timeBetweenStations =
            followingPrediction.timeToStation -
            nextPrediction.timeToStation;

        progress =
            1 -
            (
                nextPrediction.timeToStation /
                (
                    nextPrediction.timeToStation +
                    timeBetweenStations
                )
            );
    }

    progress =
        Math.max(
            0,
            Math.min(1, progress)
        );

    const scaledIndex =
        progress * (section.length - 1);

    const lowerIndex =
        Math.floor(scaledIndex);

    const upperIndex =
        Math.min(
            lowerIndex + 1,
            section.length - 1
        );

    const localProgress =
        scaledIndex - lowerIndex;

    const pointA =
        section[lowerIndex];

    const pointB =
        section[upperIndex];

    const lon =
        pointA[0] +
        (
            pointB[0] -
            pointA[0]
        ) * localProgress;

    const lat =
        pointA[1] +
        (
            pointB[1] -
            pointA[1]
        ) * localProgress;

    return {
        lat,
        lon,
        positionType: 'between',
        between: [
            previousRouteStation.station.name,
            nextPrediction.station.name
        ],
        progress
    };
}

function addElizabethTrainPositions(trains) {
    return trains.map(train => ({
        ...train,
        position: getElizabethTrainPosition(train)
    }));
}

// ==================== LIVE TRAM VEHICLE POSITIONING ====================

function normaliseTramStationName(name) {
    return String(name || '')
        .replace(/\s+Tram Stop$/i, '')
        .trim()
        .toLowerCase();
}

function getTramStationMap() {
    const stations = cachedTram?.stations || [];
    const map = new Map();

    for (const station of stations) {
        if (!station?.name) continue;

        map.set(
            normaliseTramStationName(station.name),
            station
        );
    }

    return map;
}

function getTramVehiclePosition(predictions) {
    if (!cachedTram?.stations?.length || !predictions?.length) {
        return null;
    }

    const stationMap = getTramStationMap();

    const ordered = [...predictions]
        .filter(
            prediction =>
                prediction?.stationName &&
                Number.isFinite(Number(prediction.timeToStation))
        )
        .sort(
            (a, b) =>
                Number(a.timeToStation) -
                Number(b.timeToStation)
        );

    if (!ordered.length) {
        return null;
    }

    const nextPrediction = ordered[0];
    const nextStation = stationMap.get(
        normaliseTramStationName(nextPrediction.stationName)
    );

    if (!nextStation) {
        return null;
    }

    if (ordered.length === 1) {
        return {
            lat: Number(nextStation.lat),
            lon: Number(nextStation.lon),
            positionType: 'station',
            stationName: nextStation.name,
            destinationName: nextPrediction.destinationName || null,
            direction: nextPrediction.direction || null
        };
    }

    const followingPrediction = ordered[1];
    const followingStation = stationMap.get(
        normaliseTramStationName(followingPrediction.stationName)
    );

    if (!followingStation) {
        return {
            lat: Number(nextStation.lat),
            lon: Number(nextStation.lon),
            positionType: 'station',
            stationName: nextStation.name,
            destinationName: nextPrediction.destinationName || null,
            direction: nextPrediction.direction || null
        };
    }

    const nextTime = Number(nextPrediction.timeToStation);
    const followingTime = Number(followingPrediction.timeToStation);

    const timeBetweenStations = followingTime - nextTime;

    let progress = 0;

    if (timeBetweenStations > 0) {
        progress = 1 - (
            nextTime /
            (nextTime + timeBetweenStations)
        );
    }

    progress = Math.max(0, Math.min(1, progress));

    const lineStrings = cachedTram.lineStrings || [];

    let bestPath = null;
    let bestStartDistance = Infinity;
    let bestEndDistance = Infinity;

    for (const lineString of lineStrings) {
        try {
            const parsed =
                typeof lineString === 'string'
                    ? JSON.parse(lineString)
                    : lineString;

            let coordinates = parsed;

            if (
                Array.isArray(parsed) &&
                Array.isArray(parsed[0]) &&
                Array.isArray(parsed[0][0])
            ) {
                coordinates = parsed[0];
            }

            if (!Array.isArray(coordinates) || coordinates.length < 2) {
                continue;
            }

            let startIndex = -1;
            let endIndex = -1;

            let startBest = Infinity;
            let endBest = Infinity;

            for (let i = 0; i < coordinates.length; i++) {
                const point = coordinates[i];

                if (!Array.isArray(point) || point.length < 2) {
                    continue;
                }

                const lon = Number(point[0]);
                const lat = Number(point[1]);

                const startDistance =
                    Math.pow(lat - Number(nextStation.lat), 2) +
                    Math.pow(lon - Number(nextStation.lon), 2);

                const endDistance =
                    Math.pow(lat - Number(followingStation.lat), 2) +
                    Math.pow(lon - Number(followingStation.lon), 2);

                if (startDistance < startBest) {
                    startBest = startDistance;
                    startIndex = i;
                }

                if (endDistance < endBest) {
                    endBest = endDistance;
                    endIndex = i;
                }
            }

            if (
                startIndex >= 0 &&
                endIndex >= 0 &&
                startIndex < endIndex
            ) {
                const totalEndpointDistance =
                    startBest + endBest;

                if (totalEndpointDistance < bestStartDistance + bestEndDistance) {
                    bestPath = coordinates.slice(
                        startIndex,
                        endIndex + 1
                    );

                    bestStartDistance = startBest;
                    bestEndDistance = endBest;
                }
            }
        } catch (error) {
            console.error(
                'Unable to parse Tram geometry:',
                error.message
            );
        }
    }

    if (!bestPath || bestPath.length < 2) {
        const lat =
            Number(nextStation.lat) +
            (
                Number(followingStation.lat) -
                Number(nextStation.lat)
            ) * progress;

        const lon =
            Number(nextStation.lon) +
            (
                Number(followingStation.lon) -
                Number(nextStation.lon)
            ) * progress;

        return {
            lat,
            lon,
            positionType: 'between',
            between: [
                nextStation.name,
                followingStation.name
            ],
            progress,
            positionSource: 'station-interpolation',
            destinationName: nextPrediction.destinationName || null,
            direction: nextPrediction.direction || null
        };
    }

    const segmentLengths = [];
    let totalLength = 0;

    for (let i = 1; i < bestPath.length; i++) {
        const lon1 = Number(bestPath[i - 1][0]);
        const lat1 = Number(bestPath[i - 1][1]);
        const lon2 = Number(bestPath[i][0]);
        const lat2 = Number(bestPath[i][1]);

        const length = Math.hypot(
            lat2 - lat1,
            lon2 - lon1
        );

        segmentLengths.push(length);
        totalLength += length;
    }

    if (totalLength <= 0) {
        return null;
    }

    const targetDistance = totalLength * progress;

    let travelled = 0;

    for (let i = 0; i < segmentLengths.length; i++) {
        const segmentLength = segmentLengths[i];

        if (travelled + segmentLength >= targetDistance) {
            const remaining = targetDistance - travelled;
            const segmentProgress =
                segmentLength > 0
                    ? remaining / segmentLength
                    : 0;

            const start = bestPath[i];
            const end = bestPath[i + 1];

            const lon =
                Number(start[0]) +
                (
                    Number(end[0]) -
                    Number(start[0])
                ) * segmentProgress;

            const lat =
                Number(start[1]) +
                (
                    Number(end[1]) -
                    Number(start[1])
                ) * segmentProgress;

            return {
                lat,
                lon,
                positionType: 'between',
                between: [
                    nextStation.name,
                    followingStation.name
                ],
                progress,
                positionSource: 'tram-route-geometry',
                destinationName: nextPrediction.destinationName || null,
                direction: nextPrediction.direction || null
            };
        }

        travelled += segmentLength;
    }

    const last = bestPath[bestPath.length - 1];

    return {
        lat: Number(last[1]),
        lon: Number(last[0]),
        positionType: 'between',
        between: [
            nextStation.name,
            followingStation.name
        ],
        progress: 1,
        positionSource: 'tram-route-geometry',
        destinationName: nextPrediction.destinationName || null,
        direction: nextPrediction.direction || null
    };
}
function addTramVehiclePositions(vehicles) {
    return vehicles.map(vehicle => ({
        ...vehicle,
        position: getTramVehiclePosition(vehicle.predictions)
    }));
}

// ==================== LIVE TRAM VEHICLES ====================

let cachedTramVehicles = [];
let tramVehiclesLastUpdate = null;

async function updateTramVehicles() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const url =
            `https://api.tfl.gov.uk/Line/tram/Arrivals?app_key=${encodeURIComponent(key)}`;

        const arrivals = await fetchTflJson(url);

        const vehicles = new Map();

        for (const arrival of arrivals) {
            if (!arrival.vehicleId) {
                continue;
            }

            const vehicleId = arrival.vehicleId;

            if (!vehicles.has(vehicleId)) {
                vehicles.set(vehicleId, []);
            }

            vehicles.get(vehicleId).push(arrival);
        }

        cachedTramVehicles = Array.from(
            vehicles.entries()
        ).map(([vehicleId, predictions]) => ({
            vehicleId,
            predictions
        }));

        tramVehiclesLastUpdate =
            new Date().toISOString();

        console.log(
            `Updated live Tram vehicles: ${cachedTramVehicles.length} vehicles`
        );
    } catch (error) {
        console.error(
            'Tram vehicle update failed:',
            error.message
        );
    }
}

app.get('/api/tram-trains', (req, res) => {
    const vehiclesWithPositions =
        addTramVehiclePositions(cachedTramVehicles);

    res.json({
        updatedAt: tramVehiclesLastUpdate,
        count: vehiclesWithPositions.length,
        trains: vehiclesWithPositions
    });
});

// ==================== LIVE ELIZABETH TRAINS ====================

let cachedElizabethTrains = [];
let elizabethTrainsLastUpdate = null;

async function updateElizabethTrains() {
    try {
        const key = process.env.TFL_APP_KEY;

        if (!key) {
            throw new Error('TFL_APP_KEY is missing');
        }

        const url =
            `https://api.tfl.gov.uk/Line/${elizabethLine}/Arrivals?app_key=${encodeURIComponent(key)}`;

        const arrivals = await fetchTflJson(url);

        const vehicles = new Map();

        for (const arrival of arrivals) {
            if (!arrival.vehicleId) {
                continue;
            }

            const vehicleId = arrival.vehicleId;

            if (!vehicles.has(vehicleId)) {
                vehicles.set(vehicleId, []);
            }

            vehicles.get(vehicleId).push(arrival);
        }

        cachedElizabethTrains = Array.from(
            vehicles.entries()
        ).map(([vehicleId, predictions]) => ({
            vehicleId,
            predictions
        }));

        elizabethTrainsLastUpdate =
            new Date().toISOString();

        console.log(
            `Updated live Elizabeth trains: ${cachedElizabethTrains.length} vehicles`
        );
    } catch (error) {
        console.error(
            'Elizabeth train update failed:',
            error.message
        );
    }
}

app.get('/api/elizabeth-trains', (req, res) => {
    const trainsWithPositions =
        addElizabethTrainPositions(cachedElizabethTrains);

    res.json({
        updatedAt: elizabethTrainsLastUpdate,
        count: trainsWithPositions.length,
        trains: trainsWithPositions
    });
});

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

  app.get("/api/bus-route/:route", async (req, res) => {
      try {
          const route = String(req.params.route || "").trim();
          const key = process.env.TFL_APP_KEY;

          if (!route) {
              return res.status(400).json({ error: "Bus route is required" });
          }

          if (!key) {
              throw new Error("TFL_APP_KEY is missing");
          }

          const data = await fetchTflJson(
              `https://api.tfl.gov.uk/Line/${encodeURIComponent(route)}/Route/Sequence/all?app_key=${encodeURIComponent(key)}`
          );

          res.json({
              route,
              lineStrings: data.lineStrings || [], stations: data.stations || [], stopPointSequences: data.stopPointSequences || []
          });
      } catch (error) {
          console.error("Unable to fetch Bus route geometry:", error.message);
          res.status(500).json({ error: "Unable to fetch Bus route geometry" });
      }
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
    await updateTram();
    await updateTramVehicles();
    await updateElizabethTrains();
    await updateTubeTrains();
    setInterval(updateBuses, 15000);
    setInterval(updateTube, 60000);
    setInterval(updateElizabeth, 60000);
    setInterval(updateTram, 60000);
    setInterval(updateTramVehicles, 30000);
    setInterval(updateElizabethTrains, 30000);
    setInterval(updateTubeTrains, 30000);
});
