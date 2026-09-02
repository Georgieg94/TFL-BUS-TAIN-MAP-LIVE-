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
    setInterval(updateBuses, 15000);
    setInterval(updateTube, 60000);
});
