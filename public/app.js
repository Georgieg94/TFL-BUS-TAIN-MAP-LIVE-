const map = L.map('map').setView([51.5074, -0.1278], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const tubeLayers = new Map();

async function updateTube() {
    try {
        const response = await fetch('/api/tube');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const lines = data.lines || [];

        for (const line of lines) {
            if (!line.lineStrings) continue;

            let coordinates = [];

            for (const lineString of line.lineStrings) {
                try {
                    const parsed = typeof lineString === 'string'
                        ? JSON.parse(lineString)
                        : lineString;

                    if (Array.isArray(parsed)) {
                        coordinates.push(...(Array.isArray(parsed[0]) && Array.isArray(parsed[0][0]) ? parsed[0] : parsed));
                    }
                } catch (error) {
                    console.error(`Unable to parse ${line.name} geometry`, error);
                }
            }

            if (!coordinates.length) continue;

            const latLngs = coordinates
                .filter(point => Array.isArray(point) && point.length >= 2)
                .map(point => [point[1], point[0]]);

            if (!latLngs.length) continue;

            if (tubeLayers.has(line.id)) {
                tubeLayers.get(line.id).setLatLngs(latLngs);
            } else {
                const layer = L.polyline(latLngs, {
                    weight: 4,
                    opacity: 0.85
                }).addTo(map);

                tubeLayers.set(line.id, layer);
            }
        }
    } catch (error) {
        console.error('Unable to update Tube network:', error);
    }
}

const busMarkers = new Map();

const busCluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 15,
    showCoverageOnHover: false
});

map.addLayer(busCluster);

async function updateBuses() {
    try {
        const response = await fetch('/api/live-buses');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

const data = await response.json();
const buses = data.buses || [];

        document.getElementById('vehicleCount').textContent = buses.length;
        document.getElementById('status').textContent =
            `Live TfL buses • Updated ${new Date().toLocaleTimeString()}`;

        document.getElementById('loading').style.display = 'none';

const routeFilter = (document.getElementById('routeSearch')?.value || '').trim().toLowerCase();
const currentIds = new Set();

        buses.forEach(bus => {
            if (!bus.latitude || !bus.longitude) return;

if (routeFilter && String(bus.route || '').toLowerCase() !== routeFilter) return;

            const id = bus.vehicleId || `${bus.latitude}-${bus.longitude}`;
            currentIds.add(id);

            const position = [bus.latitude, bus.longitude];

            const popup = `
                <div class="bus-popup">
                    <strong>🚌 Route ${bus.route || 'Unknown'}</strong><br>
                    Vehicle: ${bus.vehicleId || 'Unknown'}<br>
                    Destination: ${bus.destination || 'Unknown'}<br>
                    Direction: ${bus.direction || 'Unknown'}<br>
                    Operator: ${bus.operator || 'Unknown'}
                </div>
            `;

            if (busMarkers.has(id)) {
                const marker = busMarkers.get(id);
                marker.setLatLng(position);
                marker.setPopupContent(popup);
            } else {
                const busIcon = L.divIcon({
    className: 'bus-marker',
    html: `<span>${bus.route || '?'}</span>`,
    iconSize: [42, 30],
    iconAnchor: [21, 15],
    popupAnchor: [0, -15]
});

const marker = L.marker(position, {
    icon: busIcon
}).bindPopup(popup);

marker.on('click', () => {
    document.getElementById('busDetails').hidden = false;
    document.getElementById('busDetailsRoute').textContent = bus.route || '?';
    document.getElementById('busDetailsVehicle').textContent = bus.vehicleId || 'Unknown';
    document.getElementById('busDetailsDestination').textContent = bus.destination || 'Unknown';
    document.getElementById('busDetailsDirection').textContent = bus.direction || 'Unknown';
    document.getElementById('busDetailsOperator').textContent = bus.operator || 'Unknown';
    document.getElementById('busDetailsUpdated').textContent = new Date().toLocaleTimeString();
});

busCluster.addLayer(marker);

                busMarkers.set(id, marker);
            }
        });

        for (const [id, marker] of busMarkers) {
            if (!currentIds.has(id)) {
                busCluster.removeLayer(marker);
                busMarkers.delete(id);
            }
        }

    } catch (error) {
        console.error('Unable to update buses:', error);

        document.getElementById('status').textContent =
            'Unable to connect to live TfL data';
    }
}

updateBuses();

setInterval(updateBuses, 15000);

updateTube();
setInterval(updateTube, 60000);

const routeSearch = document.getElementById('routeSearch');
const clearRouteSearch = document.getElementById('clearRouteSearch');

routeSearch.addEventListener('input', () => {
    updateBuses();
});

clearRouteSearch.addEventListener('click', () => {
    routeSearch.value = '';
    updateBuses();
});


const closeBusDetails = document.getElementById('closeBusDetails');

closeBusDetails.addEventListener('click', () => {
    document.getElementById('busDetails').hidden = true;
});
