require('dotenv').config();

const https = require('https');

const url = `https://api.tfl.gov.uk/Vehicle?app_key=${process.env.TFL_APP_KEY}`;

https.get(url, (res) => {
    let data = '';

    res.on('data', chunk => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('HTTP status:', res.statusCode);
        console.log('Characters received:', data.length);
        console.log(data.substring(0, 1000));
    });
}).on('error', (error) => {
    console.error('Request failed:', error.message);
});
