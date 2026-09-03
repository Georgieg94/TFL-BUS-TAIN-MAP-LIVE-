const map = L.map('map').setView([51.5074, -0.1278], 10);

const elizabethLineColour = '#6950A1';
let elizabethLayer = L.featureGroup();

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

const tubeLayers = new Map();
const tubeLineColours = {
    bakerloo: '#B36305',
    central: '#E32017',
    circle: '#FFD300',
    district: '#00782A',
    'hammersmith-city': '#F3A9BB',
    jubilee: '#A0A5A9',
    metropolitan: '#9B0056',
    northern: '#000000',
    piccadilly: '#003688',
    victoria: '#0098D4',
    'waterloo-city': '#95CDBA'
};
const tubeTrainMarkers = new Map();
const elizabethTrainMarkers = new Map();
let elizabethData = null;

function createTubeTrainIcon(lineId) {
    const lineColours = {
        bakerloo: '#B36305',
        central: '#E32017',
        circle: '#FFD300',
        district: '#00782A',
        'hammersmith-city': '#F3A9BB',
        jubilee: '#A0A5A9',
        metropolitan: '#9B0056',
        northern: '#000000',
        piccadilly: '#003688',
        victoria: '#0098D4',
        'waterloo-city': '#95CDBA'
    };

    const colour = lineColours[lineId] || '#d50000';

    return L.divIcon({
        className: 'tube-train-marker',
        html: `<div class="tube-train-icon" style="border-color: ${colour};">🚇</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });
}

function createElizabethTrainIcon() {
    return L.divIcon({
        className: 'tube-train-marker',
        html: `<div class="tube-train-icon" style="border-color: ${elizabethLineColour};">🚇</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17]
    });
}

async function updateElizabethTrains() {
    try {
        const response = await fetch('/api/elizabeth-trains');

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

            const id = `elizabeth-${train.vehicleId}`;

            currentIds.add(id);

            const latLng = [
                position.lat,
                position.lon
            ];

            const prediction = train.predictions?.[0];

            const popup = `
                <div class="tube-train-popup">
                    <strong>🟣 Elizabeth line</strong><br>
                    Vehicle: ${train.vehicleId || 'Unknown'}<br>
                    Location: ${prediction?.stationName || 'Unknown'}<br>
                    Towards: ${prediction?.destinationName || 'Unknown'}<br>
                    Position: ${position.positionType || 'Unknown'}
                </div>
            `;

            if (elizabethTrainMarkers.has(id)) {
                const marker = elizabethTrainMarkers.get(id);

                marker.setLatLng(latLng);
                marker.setPopupContent(popup);

                if (
                    selectedLayers.has('elizabeth') &&
                    !map.hasLayer(marker)
                ) {
                marker.addTo(map);
                }
            } else {
                const marker = L.marker(
                    latLng,
                    {
                        icon: createElizabethTrainIcon(),
                        title: `Elizabeth ${train.vehicleId || ''}`
                    }
                );

                marker.bindPopup(popup);
                if (selectedLayers.has('elizabeth')) marker.addTo(map);

                elizabethTrainMarkers.set(id, marker);
            }
        }

        for (const [id, marker] of elizabethTrainMarkers) {
            if (!currentIds.has(id)) {
                map.removeLayer(marker);
                elizabethTrainMarkers.delete(id);
            }
        }
    } catch (error) {
        console.error('Unable to update live Elizabeth trains:', error);
    }
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

                if (
                    selectedLayers.has('tube') &&
                    !map.hasLayer(marker)
                ) {
                    marker.addTo(map);
                }
            } else {
                const marker = L.marker(
                    latLng,
                    {
                        icon: createTubeTrainIcon(train.lineId),
                        title: `${train.lineName || 'Tube'} ${train.vehicleId || ''}`
                    }
                );

                marker.bindPopup(popup);
                if (selectedLayers.has('tube')) marker.addTo(map);

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
    layer.setStyle({
        color: tubeLineColours[line.id] || '#666666',
        weight: 4,
        opacity: 0.85
    });
            if (map.hasLayer(layer) === false) {
                map.addLayer(layer);
            }
            } else {
const layer = L.polyline(latLngs, {
    color: tubeLineColours[line.id] || '#666666',
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

async function updateElizabethLine() {
    try {
        const response = await fetch('/api/elizabeth');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        elizabethData = data.line;

        if (!elizabethData?.lineStrings) {
            return;
        }

        elizabethLayer.clearLayers();

        for (const lineString of elizabethData.lineStrings) {
            try {
                const parsed = typeof lineString === 'string'
                    ? JSON.parse(lineString)
                    : lineString;

                const coordinates =
                    Array.isArray(parsed[0]) &&
                    Array.isArray(parsed[0][0])
                        ? parsed.flat()
                        : parsed;

                const latLngs = coordinates
                    .filter(
                        point =>
                            Array.isArray(point) &&
                            point.length >= 2
                    )
                    .map(point => [point[1], point[0]]);

                if (!latLngs.length) {
                    continue;
                }

                const layer = L.polyline(latLngs, {
                    color: elizabethLineColour,
                    weight: 4,
                    opacity: 0.9
                });

                elizabethLayer.addLayer(layer);
            } catch (error) {
                console.error(
                    'Unable to parse Elizabeth line geometry',
                    error
                );
            }
        }
    } catch (error) {
        console.error(
            'Unable to update Elizabeth line:',
            error
        );
    }
}

const busMarkers = new Map();

const busCluster = L.markerClusterGroup({
    maxClusterRadius: 50,
    disableClusteringAtZoom: 15,
    showCoverageOnHover: false
});

const busRouteSelect = document.getElementById("busRouteSelect");
let selectedBusRoute = "";
let selectedBusRouteLayer = null;
let selectedBusRoutePaths = [];

function distanceToSegmentMeters(point, start, end) {
    const latScale = 111320;
    const lonScale = 111320 * Math.cos((point.lat * Math.PI) / 180);
    const px = point.lng * lonScale;
    const py = point.lat * latScale;
    const ax = start[1] * lonScale;
    const ay = start[0] * latScale;
    const bx = end[1] * lonScale;
    const by = end[0] * latScale;

    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return Math.hypot(px - ax, py - ay);
    }

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const closestX = ax + t * dx;
    const closestY = ay + t * dy;

    return Math.hypot(px - closestX, py - closestY);
}

function isBusWithinSelectedRoute(bus) {
    if (!selectedBusRoute || !selectedBusRoutePaths.length) return true;

    const point = {
        lat: Number(bus.latitude),
        lng: Number(bus.longitude)
    };

    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;

    let nearestDistance = Infinity;

    for (const path of selectedBusRoutePaths) {
        for (let i = 1; i < path.length; i++) {
            const distance = distanceToSegmentMeters(point, path[i - 1], path[i]);
            if (distance < nearestDistance) nearestDistance = distance;
            if (nearestDistance <= 300) return true;
        }
    }

    return nearestDistance <= 300;
}

function updateBusMarkerVisibility() {
    const showBuses = typeof selectedLayers !== "undefined" && selectedLayers.has("bus");

    for (const marker of busMarkers.values()) {
        const route = marker.options.busRoute || "";
        const position = marker.getLatLng();
        const shouldShow =
            showBuses &&
            (!selectedBusRoute ||
             (route === selectedBusRoute &&
              isBusWithinSelectedRoute({
                  latitude: position.lat,
                  longitude: position.lng
              })));

        if (shouldShow) {
            if (!busCluster.hasLayer(marker)) busCluster.addLayer(marker);
        } else {
            if (busCluster.hasLayer(marker)) busCluster.removeLayer(marker);
        }
    }
}

async function updateBusRouteLine() {
    if (selectedBusRouteLayer) {
        map.removeLayer(selectedBusRouteLayer);
        selectedBusRouteLayer = null;
    }

    if (!selectedBusRoute) return;

    try {
        const response = await fetch(`/api/bus-route/${encodeURIComponent(selectedBusRoute)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const routeLayers = [];
        selectedBusRoutePaths = [];

        for (const lineString of data.lineStrings || []) {
            try {
                const parsed = typeof lineString === "string" ? JSON.parse(lineString) : lineString;
                const coordinates = Array.isArray(parsed) && Array.isArray(parsed[0]) && Array.isArray(parsed[0][0])
                    ? parsed[0]
                    : parsed;

                const latLngs = (coordinates || [])
                    .filter(point => Array.isArray(point) && point.length >= 2)
                    .map(point => [point[1], point[0]]);

                selectedBusRoutePaths.push(latLngs);
                if (!latLngs.length) continue;

                routeLayers.push(L.polyline(latLngs, {
                    color: "#ff0000",
                    weight: 5,
                    opacity: 0.9
                }));
            } catch (error) {
                console.error("Unable to parse Bus route geometry", error);
            }
        }

        if (!routeLayers.length) return;

        selectedBusRouteLayer = L.layerGroup(routeLayers).addTo(map);
          updateBusMarkerVisibility();
    } catch (error) {
        console.error("Unable to update Bus route line:", error);
    }
}

busRouteSelect.addEventListener("change", () => {
    selectedBusRoute = busRouteSelect.value;
    updateBusMarkerVisibility();
    updateBusRouteLine();
});

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
          const availableBusRoutes = [...new Set(buses.map(bus => String(bus.route || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          const currentRoute = busRouteSelect.value;
          busRouteSelect.innerHTML = '<option value="">All bus routes</option>';
          availableBusRoutes.forEach(route => {
              const option = document.createElement("option");
              option.value = route;
              option.textContent = route;
              busRouteSelect.appendChild(option);
          });
          if (availableBusRoutes.includes(currentRoute)) busRouteSelect.value = currentRoute;


const currentIds = new Set();

        buses.forEach(bus => {
            if (!bus.latitude || !bus.longitude) return;


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
                  marker.options.busRoute = String(bus.route || "").trim();
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
  marker.options.busRoute = String(bus.route || "").trim();

marker.on('click', () => {
    document.getElementById('busDetails').hidden = false;
    document.getElementById('busDetailsRoute').textContent = bus.route || '?';
    document.getElementById('busDetailsVehicle').textContent = bus.vehicleId || 'Unknown';
    document.getElementById('busDetailsDestination').textContent = bus.destination || 'Unknown';
    document.getElementById('busDetailsDirection').textContent = bus.direction || 'Unknown';
    document.getElementById('busDetailsOperator').textContent = bus.operator || 'Unknown';
    document.getElementById('busDetailsUpdated').textContent = new Date().toLocaleTimeString();
});

  if (selectedLayers.has("bus") && (!selectedBusRoute || marker.options.busRoute === selectedBusRoute)) busCluster.addLayer(marker);

                busMarkers.set(id, marker);
            }
        });

        for (const [id, marker] of busMarkers) {
            if (!currentIds.has(id)) {
                busCluster.removeLayer(marker);
                busMarkers.delete(id);
            }
        }

          updateBusMarkerVisibility();
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

updateElizabethLine();
setInterval(updateElizabethLine, 60000);

updateTubeTrains();
setInterval(updateTubeTrains, 30000);

updateElizabethTrains();
setInterval(updateElizabethTrains, 30000);

closeBusDetails.addEventListener('click', () => {
    document.getElementById('busDetails').hidden = true;
});

// ==================== NETWORK LAYER SELECTOR ====================

const selectedLayers = new Set();

const networkOptions = document.querySelectorAll('.network-option:not(:disabled)');
const selectAllLayers = document.getElementById('selectAllLayers');
const viewNetwork = document.getElementById('viewNetwork');
const networkSelector = document.getElementById('networkSelector');
const changeNetwork = document.getElementById('changeNetwork');

function updateNetworkLayers() {
    const showBuses = selectedLayers.has('bus');
    const showTube = selectedLayers.has('tube');
    const showElizabeth = selectedLayers.has('elizabeth');

      document.getElementById('busRouteFilter').hidden = !showBuses;
      document.getElementById('tubeLineFilter').hidden = !showTube;
      document.getElementById('elizabethLineFilter').hidden = !showElizabeth;

    if (showBuses) {
        if (!map.hasLayer(busCluster)) {
            map.addLayer(busCluster);
        }
    } else {
        if (map.hasLayer(busCluster)) {
            map.removeLayer(busCluster);
        }
    }
      updateBusMarkerVisibility();

      if (!showBuses) {
          if (selectedBusRouteLayer) {
              map.removeLayer(selectedBusRouteLayer);
              selectedBusRouteLayer = null;
          }
      } else if (selectedBusRoute) {
          updateBusRouteLine();
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

    if (elizabethLayer) {
        if (showElizabeth) {
            if (!map.hasLayer(elizabethLayer)) {
                map.addLayer(elizabethLayer);
            }
        } else {
            if (map.hasLayer(elizabethLayer)) {
                map.removeLayer(elizabethLayer);
            }
        }
    }

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

    elizabethTrainMarkers.forEach(marker => {
        if (showElizabeth) {
            if (!map.hasLayer(marker)) {
                map.addLayer(marker);
            }
        } else {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });

    networkOptions.forEach(option => {
        option.classList.toggle(
            'selected',
            selectedLayers.has(option.dataset.layer)
        );
    });
}

networkOptions.forEach(option => {
    option.addEventListener('click', () => {
        const layer = option.dataset.layer;

        if (selectedLayers.has(layer)) {
            selectedLayers.delete(layer);
        } else {
            selectedLayers.add(layer);
        }

        updateNetworkLayers();
    });
});

selectAllLayers.addEventListener('click', () => {
    networkOptions.forEach(option => {
        selectedLayers.add(option.dataset.layer);
    });

    updateNetworkLayers();
});

viewNetwork.addEventListener('click', () => {
    networkSelector.hidden = true;
    updateNetworkLayers();
});

changeNetwork.addEventListener('click', () => {
    networkSelector.hidden = false;
});

updateNetworkLayers();

