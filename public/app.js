const map = L.map('map').setView([51.5074, -0.1278], 10);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const tubeLayers = new Map();
const tubeTrainMarkers = new Map();

function createTubeTrainIcon() {
    return L.divIcon({
        className: 'tube-train-marker',
        html: '<div class="tube-train-icon">🚇</div>',
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });
}

async function updateTubeTrains() {
    try {
        const response = await fetch('/api/tube-trains');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const trains = data.trains || [];
        const currentIds = new Set();

        for (const train of trains) {
            const position = train.position;

            if (
                !position ||
                typeof position.lat !== 'number' ||
                typeof position.lon !== 'number'
            ) {
                continue;
            }

            const id = `${train.lineId}-${train.vehicleId}`;

            currentIds.add(id);

            const latLng = [
                position.lat,
                position.lon
            ];

            const popup = `
                <div class="tube-train-popup">
                    <strong>🚇 ${train.lineName || 'Tube Line'}</strong><br>
                    Vehicle: ${train.vehicleId || 'Unknown'}<br>
                    Location: ${train.currentLocation || 'Unknown'}<br>
                    Towards: ${train.towards || train.destinationName || 'Unknown'}<br>
                    Position: ${position.positionType || 'Unknown'}
                </div>
            `;

            if (tubeTrainMarkers.has(id)) {
                const marker = tubeTrainMarkers.get(id);

                marker.setLatLng(latLng);
                marker.setPopupContent(popup);

                if (!map.hasLayer(marker)) {
                    marker.addTo(map);
                }
            } else {
                const marker = L.marker(
                    latLng,
                    {
                        icon: createTubeTrainIcon(),
                        title: `${train.lineName || 'Tube'} ${train.vehicleId || ''}`
                    }
                );

                marker.bindPopup(popup);
                marker.addTo(map);

                tubeTrainMarkers.set(id, marker);
            }
        }

        for (const [id, marker] of tubeTrainMarkers) {
            if (!currentIds.has(id)) {
                map.removeLayer(marker);
                tubeTrainMarkers.delete(id);
            }
        }
    } catch (error) {
        console.error('Unable to update live Tube trains:', error);
    }
}


async function updateTube() {
    try {
        const response = await fetch('/api/tube');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const lines = data.lines || [];

    const routeFilter = (document.getElementById('routeSearch')?.value || '').trim().toLowerCase();
    const visibleTubeIds = new Set();

        for (const line of lines) {
        const matchesSearch =
            !routeFilter ||
            line.name.toLowerCase().includes(routeFilter) ||
            line.id.toLowerCase().includes(routeFilter);

        if (!matchesSearch) {
            if (tubeLayers.has(line.id)) {
                map.removeLayer(tubeLayers.get(line.id));
            }
            continue;
        }

        visibleTubeIds.add(line.id);

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
                const layer = tubeLayers.get(line.id);
            layer.setLatLngs(latLngs);
            if (map.hasLayer(layer) === false) {
                map.addLayer(layer);
            }
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

updateTubeTrains();
setInterval(updateTubeTrains, 30000);

const routeSearch = document.getElementById('routeSearch');
const clearRouteSearch = document.getElementById('clearRouteSearch');

routeSearch.addEventListener('input', () => {
    if (selectedTransportMode === 'tube') {
        updateTube();
    } else {
        updateBuses();
    }
});

clearRouteSearch.addEventListener('click', () => {
    routeSearch.value = '';
    if (selectedTransportMode === 'tube') {
    updateTube();
} else {
    updateBuses();
}
});


const closeBusDetails = document.getElementById('closeBusDetails');

closeBusDetails.addEventListener('click', () => {
    document.getElementById('busDetails').hidden = true;
});

// ==================== TRANSPORT MODE SELECTOR ====================

let selectedTransportMode = 'bus';

const transportTabs = document.querySelectorAll('.transport-tab');

function updateTransportMode() {
    const showBuses =
        selectedTransportMode === 'bus' ||
        selectedTransportMode === 'all';

    const showTube =
        selectedTransportMode === 'tube' ||
        selectedTransportMode === 'all';

    if (showBuses) {
        if (!map.hasLayer(busCluster)) {
            map.addLayer(busCluster);
        }
    } else {
        if (map.hasLayer(busCluster)) {
            map.removeLayer(busCluster);
        }
    }

    tubeLayers.forEach(layer => {
        if (showTube) {
            if (!map.hasLayer(layer)) {
                map.addLayer(layer);
            }
        } else {
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
        }
    });

        tubeTrainMarkers.forEach(marker => {
        if (showTube) {
            if (!map.hasLayer(marker)) {
                map.addLayer(marker);
            }
        } else {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });

transportTabs.forEach(tab => {
        tab.classList.toggle(
            'active',
            tab.dataset.mode === selectedTransportMode
        );
    });

    const routeSearch = document.getElementById('routeSearch');

    if (selectedTransportMode === 'bus') {
        routeSearch.placeholder = 'Search bus route (e.g. 127)';
    } else if (selectedTransportMode === 'tube') {
        routeSearch.placeholder = 'Search Tube line or station';
    } else if (selectedTransportMode === 'all') {
        routeSearch.placeholder = 'Search transport';
    } else {
        routeSearch.placeholder = `Search ${selectedTransportMode}`;
    }
}

transportTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        selectedTransportMode = tab.dataset.mode;
        updateTransportMode();
    });
});

updateTransportMode();
