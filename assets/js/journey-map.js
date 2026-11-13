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

    const asString = value => (typeof value === "string" ? value.trim() : "");
    const asOptionalString = value => asString(value) || null;
    const toTimestamp = value => {
        const timestamp = Date.parse(value);

        return Number.isNaN(timestamp) ? null : timestamp;
    };
    const ensureTarget = (targets, id) => {
        if (!targets.has(id)) {
            targets.set(id, {
                id,
                color: null,
                description: "",
                count: null,
                locations: [],
            });
        }

        return targets.get(id);
    };

    const normalizeTarget = target => {
        const id = asString(target?.id);

        if (!id.startsWith(TRIP_PREFIX)) return null;

        const count = Number(target.count);

        return {
            id,
            color: asOptionalString(target.color),
            description: asString(target.description),
            count: Number.isFinite(count) ? count : null,
            locations: [],
        };
    };

    const normalizeLocation = postData => {
        const title = asString(postData?.title);
        const date = asString(postData?.date);
        const coordinates = parseLocation(postData?.excerpt);
        const timestamp = toTimestamp(date);

        if (!coordinates || !title || timestamp === null) return null;

        return {
            title,
            date: timestamp,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            targetIds: Array.isArray(postData.targetIds)
                ? postData.targetIds.map(asString).filter(id => id.startsWith(TRIP_PREFIX))
                : [],
            color: null,
            url: asOptionalString(postData.url),
            image: asOptionalString(postData.image),
            imageAlt: asOptionalString(postData.imageAlt),
            opacity: 1,
        };
    };

    const normalizeStop = (target, line) => {
        const trimmed = line.trim();

        if (!trimmed) return null;

        const [rawTitle, rawDate, rawLocation] = trimmed.split(";");
        const title = rawTitle?.trim();
        const date = rawDate?.trim();
        const coordinates = parseLocation(rawLocation);
        const timestamp = toTimestamp(date);

        if (!coordinates || !title || timestamp === null) return null;

        return {
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
        };
    };

    const readJsonScript = id => {
        const el = document.getElementById(id);

        if (!el) return null;

        try {
            return JSON.parse(el.textContent);
        } catch (error) {
            console.warn(`Journey map: could not parse #${id}`, error);
            return null;
        }
    };

    const buildMapData = data => {
        const rawTargets = Array.isArray(data?.targets) ? data.targets : [];
        const targets = new Map(
            rawTargets.map(normalizeTarget).filter(Boolean).map(target => [target.id, target])
        );
        const locations = (Array.isArray(data?.locations) ? data.locations : [])
            .map(normalizeLocation)
            .filter(Boolean);

        locations.forEach(location => {
            location.targetIds.forEach(id => ensureTarget(targets, id));
            location.color = targets.get(location.targetIds[0])?.color || null;
            location.targetIds.forEach(id => targets.get(id)?.locations.push(location));
        });

        targets.forEach(target => {
            if (!target.description) return;

            target.description
                .split(/\r?\n/)
                .map(line => normalizeStop(target, line))
                .filter(Boolean)
                .forEach(location => {
                    locations.push(location);
                    target.locations.push(location);
                });
        });

        targets.forEach(target => {
            target.locations.sort((a, b) => a.date - b.date);
            target.color = normalizeColor(target.color);
        });

        locations.forEach(location => {
            location.color = normalizeColor(location.color);
        });

        return {
            tiles: data?.tiles && typeof data.tiles === "object" ? data.tiles : {},
            targets,
            locations,
        };
    };

    const collectIndexItems = () => {
        const items = new Map();

        document.querySelectorAll(".journey-index-item").forEach(item => {
            const id = item.dataset.targetId?.trim();

            if (!id?.startsWith(TRIP_PREFIX)) return;

            items.set(id, item);
        });

        return items;
    };

    const enhanceSinglePostLinks = (targets, indexItems) => {
        targets.forEach(target => {
            if (target.count !== 1) return;

            const location = target.locations.find(item => item.url);
            const entry = indexItems.get(target.id)?.closest(".journey-index-entry");
            const link = entry?.querySelector(".journey-index-link");

            if (!location || !link) return;

            link.href = location.url;
            link.setAttribute("aria-label", `View ${location.title}`);
        });
    };

    const data = readJsonScript("journey-map-data");

    if (!data) return;

    const { tiles, targets, locations } = buildMapData(data);
    const indexItems = collectIndexItems();

    enhanceSinglePostLinks(targets, indexItems);

    const tileUrlLight = asOptionalString(tiles.light) || DEFAULT_TILE_URL_LIGHT;
    const tileUrlDark = asOptionalString(tiles.dark) || DEFAULT_TILE_URL_DARK;
    const attribution = asOptionalString(tiles.attribution) || DEFAULT_ATTRIBUTION;
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
            navigatePopup(location, -1);
        });

        rightButton.addEventListener("click", event => {
            event.stopPropagation();
            navigatePopup(location, 1);
        });

        return popupEl;
    };

    locations.forEach(location => {
        const marker = L.marker([location.latitude, location.longitude], {
            icon: createLocationIcon(location.color),
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
        .reduce(
            (latest, target) =>
                !latest || getLastStopDate(target) > getLastStopDate(latest)
                    ? target
                    : latest,
            null
        );

    targets.forEach(target => {
        if (!target.locations.length) return;

        const latlngs = target.locations.map(({ latitude, longitude }) => [latitude, longitude]);
        const hitLine = L.polyline(latlngs, { ...lineHitStyle, color: target.color }).addTo(map);

        hitLine.on("click", () => selectTarget(target.id, { toggle: true }));

        const line = L.polyline(latlngs, {
            ...lineStyle,
            color: target.color,
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

        locations.forEach(location => {
            const isRelated = targetId && location.targetIds.includes(targetId);
            let endpoint = null;

            if (isRelated && hasMultipleStops) {
                if (location === firstLocation) endpoint = "start";
                if (location === lastLocation) endpoint = "end";
            }

            location.marker.setIcon(createLocationIcon(location.color, endpoint));
            location.marker.setOpacity(
                targetId && !isRelated ? DIMMED_MARKER_OPACITY : location.opacity
            );
        });

        cluster.refreshClusters();
    };

    const setIndexActive = targetId => {
        indexItems.forEach((item, id) => {
            const isActive = id === targetId;

            item.classList.toggle("is-active", isActive);

            if (isActive) {
                item.setAttribute("aria-current", "true");
            } else {
                item.removeAttribute("aria-current");
            }
        });
    };

    const clearTargetSelection = () => {
        if (!activeTargetId) return;

        activeTargetId = null;
        updateSelectionAppearance(null);
        setIndexActive(null);
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
        setIndexActive(targetId);

        if (fit) {
            map.flyToBounds(line.getBounds(), {
                maxZoom: FIT_MAX_ZOOM,
                duration: 0.8,
            });
        }
    };

    indexItems.forEach((item, id) => {
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
        const leftButton = popupEl.querySelector(".map-popup-left");
        const rightButton = popupEl.querySelector(".map-popup-right");

        if (!nav || !leftButton || !rightButton) return;

        const { isNavigable, hasPrev, hasNext } = getNavigationState(location);

        nav.hidden = !isNavigable;
        leftButton.disabled = !hasPrev;
        rightButton.disabled = !hasNext;
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
