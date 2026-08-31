require('dotenv').config();

const https = require('https');

const apiKey = process.env.TFL_APP_KEY;

const modes = [
    'tube',
    'overground',
    'dlr',
    'tram',
    'bus'
];

function getModeStatus(mode) {
    return new Promise((resolve, reject) => {
        const url = `https://api.tfl.gov.uk/Line/Mode/${mode}/Status?app_key=${apiKey}`;

        https.get(url, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    resolve({
                        mode,
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch {
                    resolve({
                        mode,
                        status: res.statusCode,
                        data
                    });
                }
            });
        }).on('error', reject);
    });
}

async function main() {
    for (const mode of modes) {
        const result = await getModeStatus(mode);

        console.log(`\n=== ${mode.toUpperCase()} ===`);
        console.log(`HTTP ${result.status}`);

        if (Array.isArray(result.data)) {
            result.data.slice(0, 5).forEach(line => {
                const status = line.lineStatuses?.[0]?.statusSeverityDescription || 'Unknown';
                console.log(`${line.name}: ${status}`);
            });

            if (result.data.length > 5) {
                console.log(`...and ${result.data.length - 5} more`);
            }
        } else {
            console.log(result.data);
        }
    }
}

main();
