(function () {
    const TRIP_PREFIX = "trip-";
    const FIT_MAX_ZOOM = 10;
    const CLUSTER_RADIUS = 20;
    const MARKER_SIZE = 16;
    const DIMMED_LINE_OPACITY = 0.2;
    const DIMMED_MARKER_OPACITY = 0.3;
    const DEFAULT_TILE_URL_LIGHT =
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_520j_1_9a99661e0cf1de5d4a092737";
    const DEFAULT_TILE_URL_DARK =
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_520j_1_9a99661e0cf1de5d4a092737";
    const DEFAULT_ATTRIBUTION =
        "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors © <a href='https://carto.com/attributions'>CARTO</a>";

    const mapEl = document.getElementById("map");

    if (!mapEl || !window.L || !L.markerClusterGroup) return;

    const fallbackColor =
        getComputedStyle(document.documentElement).getPropertyValue("--ghost-accent-color").trim() || "#3eb0ef";
    const colorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
    const locationPattern = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/;

    const normalizeColor = color => colorPattern.test(color || "") ? color : fallbackColor;

    const parseLocation = raw => {
        const match = raw?.match(locationPattern);

        if (!match) return null;

        const latitude = Number(match[1]);
        const longitude = Number(match[2]);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

        return { latitude, longitude };
    };

    const buildMapData = () => {
        const targets = new Map();
        const indexItems = new Map();

        document.querySelectorAll(".journey-index-item").forEach(item => {
            const id = item.dataset.targetId?.trim();

            if (!id?.startsWith(TRIP_PREFIX)) return;

            indexItems.set(id, item);
            targets.set(id, {
                id,
                color: item.dataset.color?.trim() || null,
                description: item.dataset.description?.trim() || "",
            });
        });

        const locations = [];

        document.querySelectorAll(".journey-post").forEach(postEl => {
            const title = postEl.dataset.title?.trim();
            const date = postEl.dataset.date?.trim();
            const url = postEl.dataset.url?.trim() || null;
            const image = postEl.dataset.image?.trim() || null;
            const imageAlt = postEl.dataset.imageAlt?.trim() || null;
            const coordinates = parseLocation(postEl.dataset.excerpt);
            const targetIds = (postEl.dataset.targetIds?.trim() || "")
                .split(/\s+/)
                .filter(id => id.startsWith(TRIP_PREFIX));

            if (!coordinates || !title || !date) return;

            const timestamp = Date.parse(date);

            if (Number.isNaN(timestamp)) return;

            targetIds.forEach(id => {
                if (!targets.has(id)) {
                    targets.set(id, {
                        id,
                        color: null,
                        description: "",
                    });
                }
            });

            locations.push({
                title,
                date: timestamp,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                targetIds,
                color: targets.get(targetIds[0])?.color || null,
                url,
                image,
                imageAlt,
                opacity: 1,
            });
        });

        targets.forEach(target => {
            if (!target.description) return;

            target.description.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();

                if (!trimmed) return;

                const [rawTitle, rawDate, rawLocation] = trimmed.split(";");
                const title = rawTitle?.trim();
                const date = rawDate?.trim();
                const coordinates = parseLocation(rawLocation);

                if (!coordinates || !title || !date) return;

                const timestamp = Date.parse(date);

                if (Number.isNaN(timestamp)) return;

                locations.push({
                    title,
                    date: timestamp,
                    latitude: coordinates.latitude,
                    longitude: coordinates.longitude,
                    targetIds: [target.id],
                    color: target.color,
                    url: null,
                    image: null,
                    imageAlt: null,
                    opacity: 0.5,
                });
            });
        });

        return {
            targets: Array.from(targets.values()).map(({ description, ...target }) => target),
            locations,
            indexItems,
        };
    };

    const mapData = buildMapData();

    const tileUrlLight = mapEl.dataset.tileUrlLight?.trim() || DEFAULT_TILE_URL_LIGHT;
    const tileUrlDark = mapEl.dataset.tileUrlDark?.trim() || DEFAULT_TILE_URL_DARK;
    const attribution = mapEl.dataset.tileAttribution?.trim() || DEFAULT_ATTRIBUTION;
    const tileLayer = L.tileLayer(tileUrlLight, { maxZoom: 19, attribution });
    const setMapBaseColor = ({ matches }) => tileLayer.setUrl(matches ? tileUrlDark : tileUrlLight);
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");

    darkMode.addEventListener("change", setMapBaseColor);
    setMapBaseColor(darkMode);

    const map = L.map(mapEl);

    let activeTargetId = null;
    let suppressPopupCloseDeselect = false;

    const suppressPopupClose = () => {
        suppressPopupCloseDeselect = true;

        setTimeout(() => {
            suppressPopupCloseDeselect = false;
        }, 0);
    };
    const cluster = L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: CLUSTER_RADIUS,
        iconCreateFunction: clusterGroup => {
            const isDimmed = Boolean(
                activeTargetId &&
                !clusterGroup.getAllChildMarkers().some(marker =>
                    marker.targetIds?.has(activeTargetId)
                )
            );

            return L.divIcon({
                html: `<div><span>${clusterGroup.getChildCount()}</span></div>`,
                className: `marker-cluster${isDimmed ? " is-dimmed" : ""}`,
                iconSize: L.point(26, 26),
            });
        },
    });

    const popupTemplate = document.getElementById("journey-map-popup-template");

    if (!popupTemplate) return;

    const popupOptions = {
        className: "map-popup-container",
        maxWidth: 320,
        autoPan: true,
    };
    const lineStyle = { dashArray: "8 6", opacity: 0.8, weight: 3 };
    const selectedLineStyle = { ...lineStyle, opacity: 1, weight: 5 };
    const lineHitStyle = {
        opacity: 0.001,
        weight: 20,
        lineCap: "round",
        lineJoin: "round",
        bubblingMouseEvents: false,
    };

    tileLayer.addTo(map);

    const createLocationIcon = (color, endpoint = null) => L.divIcon({
        className: `map-location-marker${endpoint ? ` is-trip-${endpoint}` : ""}`,
        html: `<span style="--marker-color: ${color};"></span>`,
        iconSize: [MARKER_SIZE, MARKER_SIZE],
        iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
        popupAnchor: [0, -MARKER_SIZE / 2],
    });

    const createPopupContent = location => {
        const popupEl = popupTemplate.content.firstElementChild.cloneNode(true);
        const hasImage = Boolean(location.image);
        const image = popupEl.querySelector(".map-popup-image");
        const gradient = popupEl.querySelector(".map-popup-gradient");
        const titleEl = popupEl.querySelector(".map-popup-title");
        const leftButton = popupEl.querySelector(".map-popup-left");
        const rightButton = popupEl.querySelector(".map-popup-right");

        popupEl.classList.toggle("has-image", hasImage);

        if (hasImage) {
            image.src = location.image;
            image.alt = location.imageAlt || location.title;
        } else {
            image.remove();
            gradient.remove();
        }

        if (location.url) {
            const link = document.createElement("a");

            link.href = location.url;
            link.textContent = location.title;
            titleEl.replaceChildren(link);
        } else {
            titleEl.textContent = location.title;
        }

        leftButton.addEventListener("click", event => {
            event.stopPropagation();
            navigatePopup(location, 1);
        });

        rightButton.addEventListener("click", event => {
            event.stopPropagation();
            navigatePopup(location, -1);
        });

        return popupEl;
    };

    mapData.locations.forEach(location => {
        const marker = L.marker([location.latitude, location.longitude], {
            icon: createLocationIcon(normalizeColor(location.color)),
            opacity: location.opacity,
            bubblingMouseEvents: false,
        });

        location.marker = marker;
        marker.targetIds = new Set(location.targetIds);
        cluster.addLayer(marker);
        marker.on("click", () => {
            const targetId = location.targetIds[0];

            if (!targetId || marker.isPopupOpen()) return;

            selectTarget(targetId, { fit: false });
        });
        marker.bindPopup(() => createPopupContent(location), popupOptions);
        marker.on("popupopen", event => {
            const popupEl = event.popup.getElement()?.querySelector(".map-popup");

            if (popupEl) updatePopupNav(location, popupEl);
        });
    });

    map.addLayer(cluster);

    cluster.on("clusterclick", event => {
        if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
    });

    const targets = new Map(
        mapData.targets.map(target => [target.id, { ...target, locations: [] }])
    );

    mapData.locations.forEach(location => {
        location.targetIds.forEach(targetId => {
            targets.get(targetId)?.locations.push(location);
        });
    });

    targets.forEach(target => {
        target.locations.sort((a, b) => a.date - b.date);
    });

    const getLastStopDate = target =>
        target?.locations?.length
            ? target.locations[target.locations.length - 1].date
            : 0;

    const indexList = document.querySelector(".journey-index-list");

    if (indexList) {
        const entries = Array.from(indexList.querySelectorAll(".journey-index-entry"));

        entries.sort((a, b) => {
            const aId = a.querySelector(".journey-index-item")?.dataset.targetId;
            const bId = b.querySelector(".journey-index-item")?.dataset.targetId;

            return (
                getLastStopDate(targets.get(bId)) -
                getLastStopDate(targets.get(aId))
            );
        });

        entries.forEach(entry => indexList.appendChild(entry));
    }

    const mostRecentTarget = Array.from(targets.values())
        .filter(target => target.locations.length)
        .reduce((latest, target) => {
            if (!latest) return target;

            const latestLocation = latest.locations[latest.locations.length - 1];
            const targetLocation = target.locations[target.locations.length - 1];

            return targetLocation.date > latestLocation.date ? target : latest;
        }, null);

    targets.forEach(target => {
        if (!target.locations.length) return;

        const color = normalizeColor(target.color);
        const latlngs = target.locations.map(({ latitude, longitude }) => [latitude, longitude]);
        const hitLine = L.polyline(latlngs, { ...lineHitStyle, color }).addTo(map);

        target.color = color;
        hitLine.on("click", () => selectTarget(target.id, { toggle: true }));

        const line = L.polyline(latlngs, {
            ...lineStyle,
            color,
            bubblingMouseEvents: false,
            className: "journey-trip-line",
        }).addTo(map);

        line.on("click", () => selectTarget(target.id, { toggle: true }));

        target.line = line;
    });

    const applyLineAppearance = targetId => {
        targets.forEach(target => {
            if (!target.line) return;

            const isSelected = target.id === targetId;

            target.line.setStyle(
                isSelected
                    ? { ...selectedLineStyle, color: target.color }
                    : {
                        ...lineStyle,
                        color: target.color,
                        opacity: targetId ? DIMMED_LINE_OPACITY : lineStyle.opacity,
                    }
            );
            target.line.getElement()?.classList.toggle("is-active", isSelected);
        });
    };

    const updateSelectionAppearance = targetId => {
        applyLineAppearance(targetId);

        const selectedTarget = targetId ? targets.get(targetId) : null;
        const hasMultipleStops = selectedTarget?.locations.length > 1;
        const firstLocation = hasMultipleStops ? selectedTarget.locations[0] : null;
        const lastLocation = hasMultipleStops
            ? selectedTarget.locations[selectedTarget.locations.length - 1]
            : null;

        mapData.locations.forEach(location => {
            const isRelated = targetId && location.targetIds.includes(targetId);
            let endpoint = null;

            if (isRelated && hasMultipleStops) {
                if (location === firstLocation) endpoint = "start";
                if (location === lastLocation) endpoint = "end";
            }

            location.marker.setIcon(
                createLocationIcon(normalizeColor(location.color), endpoint)
            );
            location.marker.setOpacity(
                targetId && !isRelated ? DIMMED_MARKER_OPACITY : location.opacity
            );
        });

        cluster.refreshClusters();
    };

    const clearTargetSelection = () => {
        if (!activeTargetId) return;

        activeTargetId = null;
        updateSelectionAppearance(null);

        mapData.indexItems.forEach(item => {
            item.classList.remove("is-active");
            item.removeAttribute("aria-current");
        });
    };

    const selectTarget = (targetId, { fit = true, toggle = false } = {}) => {
        const line = targets.get(targetId)?.line;

        if (!line) return;

        if (toggle && activeTargetId === targetId) {
            clearTargetSelection();
            return;
        }

        activeTargetId = targetId;
        suppressPopupClose();
        updateSelectionAppearance(targetId);
        line.bringToFront();

        mapData.indexItems.forEach((item, id) => {
            const isActive = id === targetId;

            item.classList.toggle("is-active", isActive);

            if (isActive) {
                item.setAttribute("aria-current", "true");
            } else {
                item.removeAttribute("aria-current");
            }
        });

        if (fit) {
            map.flyToBounds(line.getBounds(), {
                maxZoom: FIT_MAX_ZOOM,
                duration: 0.8,
            });
        }
    };

    mapData.indexItems.forEach((item, id) => {
        if (!targets.get(id)?.line) {
            item.disabled = true;
            return;
        }

        item.addEventListener("click", () => selectTarget(id, { toggle: true }));
    });

    map.on("click", () => {
        if (activeTargetId) clearTargetSelection();
    });

    map.on("popupclose", () => {
        if (!suppressPopupCloseDeselect) {
            clearTargetSelection();
        }
    });

    const getNavigationTargetId = location => {
        if (activeTargetId && location.targetIds.includes(activeTargetId)) {
            return activeTargetId;
        }

        return location.targetIds[0];
    };

    const getNavigationState = location => {
        const targetId = getNavigationTargetId(location);
        const target = targets.get(targetId);
        const index = target ? target.locations.indexOf(location) : -1;
        const isNavigable = Boolean(target && target.locations.length > 1 && index >= 0);

        return {
            target,
            targetId,
            index,
            isNavigable,
            hasPrev: isNavigable && index > 0,
            hasNext: isNavigable && index < target.locations.length - 1,
        };
    };

    const updatePopupNav = (location, popupEl) => {
        const nav = popupEl.querySelector(".map-popup-nav");
        const position = popupEl.querySelector(".map-popup-position");
        const leftButton = popupEl.querySelector(".map-popup-left");
        const rightButton = popupEl.querySelector(".map-popup-right");

        if (!nav || !leftButton || !rightButton) return;

        const { target, index, isNavigable, hasPrev, hasNext } = getNavigationState(location);

        nav.hidden = !isNavigable;
        leftButton.disabled = !hasNext;
        rightButton.disabled = !hasPrev;

        if (position) {
            position.textContent = isNavigable
                ? `${index + 1} / ${target.locations.length}`
                : "";
        }
    };

    const navigatePopup = (location, direction) => {
        const { target, targetId, index } = getNavigationState(location);

        if (!target || index < 0) return;

        const nextLocation = target.locations[index + direction];

        if (!nextLocation) return;

        const nextMarker = nextLocation.marker;

        if (!nextMarker) return;

        selectTarget(targetId, { fit: false });
        map.closePopup();

        if (map.hasLayer(nextMarker)) {
            nextMarker.openPopup();
            return;
        }

        const content = createPopupContent(nextLocation);

        updatePopupNav(nextLocation, content);

        L.popup(popupOptions)
            .setLatLng(nextMarker.getLatLng())
            .setContent(content)
            .openOn(map);
    };

    const fitInitialView = () => {
        const mostRecentLayer = mostRecentTarget?.line;

        if (mostRecentLayer) {
            map.fitBounds(mostRecentLayer.getBounds(), { maxZoom: FIT_MAX_ZOOM });
            return;
        }

        if (cluster.getLayers().length) {
            map.fitBounds(cluster.getBounds(), { maxZoom: FIT_MAX_ZOOM });
            return;
        }

        map.setView([20, 0], 2);
    };

    const resizeObserver = new ResizeObserver(() => map.invalidateSize({ pan: false }));

    resizeObserver.observe(mapEl);

    requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        fitInitialView();
    });
})();
