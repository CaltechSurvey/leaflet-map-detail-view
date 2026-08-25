/* Leaflet.DetailView - draw a box on a map to open a zoomable inset detail map,
   connected to the source area by a leader line. */
(function (factory) {
	if (typeof define === 'function' && define.amd) {
		define(['leaflet'], factory);
	} else if (typeof exports === 'object') {
		module.exports = factory(require('leaflet'));
	} else {
		factory(window.L);
	}
}(function (L) {
	'use strict';

	var EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

	/* Pointer events cover mouse, touch and pen; fall back to mouse events. */
	var POINTER = window.PointerEvent
		? { down: 'pointerdown', move: 'pointermove', up: 'pointerup pointercancel' }
		: { down: 'mousedown', move: 'mousemove', up: 'mouseup' };

	var topPanelZIndex = 700;

	var DEFAULT_PANES = [
		'mapPane', 'tilePane', 'overlayPane', 'shadowPane', 'markerPane', 'tooltipPane', 'popupPane'
	];

	/* Map options the inset must share with its parent to render the same tiles. */
	var INHERITED_MAP_OPTIONS = ['crs', 'minZoom', 'maxZoom', 'maxBounds', 'preferCanvas'];

	/* Ordered list of layer cloners; first match wins. Extend with
	   L.DetailView.registerLayerCloner for app-specific layer classes. */
	var layerCloners = [
		{
			test: function (layer) { return L.TileLayer.WMS && layer instanceof L.TileLayer.WMS; },
			clone: function (layer) {
				return L.tileLayer.wms(layer._url, L.extend({}, layer.options, layer.wmsParams));
			}
		},
		{
			test: function (layer) { return layer instanceof L.TileLayer && layer._url; },
			clone: function (layer) { return L.tileLayer(layer._url, L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return layer instanceof L.ImageOverlay && layer._url; },
			clone: function (layer) {
				return L.imageOverlay(layer._url, layer.getBounds(), L.extend({}, layer.options));
			}
		},
		{
			test: function (layer) { return layer instanceof L.Marker; },
			clone: function (layer) { return L.marker(layer.getLatLng(), L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return layer instanceof L.Circle; },
			clone: function (layer) { return L.circle(layer.getLatLng(), L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return layer instanceof L.CircleMarker; },
			clone: function (layer) { return L.circleMarker(layer.getLatLng(), L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return layer instanceof L.Polygon; },
			clone: function (layer) { return L.polygon(layer.getLatLngs(), L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return layer instanceof L.Polyline; },
			clone: function (layer) { return L.polyline(layer.getLatLngs(), L.extend({}, layer.options)); }
		},
		{
			test: function (layer) { return typeof layer.toGeoJSON === 'function'; },
			clone: function (layer) {
				return L.geoJSON(layer.toGeoJSON(), {
					pane: layer.options && layer.options.pane,
					style: function () { return L.extend({}, layer.options); },
					pointToLayer: function (feature, latlng) {
						return L.marker(latlng, { icon: (layer.options && layer.options.icon) || new L.Icon.Default() });
					}
				});
			}
		},
		{
			// last resort for third-party layers (Esri, vector tiles, ...)
			test: function (layer) {
				return typeof layer.constructor === 'function' &&
					(layer._url || (layer.options && layer.options.url));
			},
			clone: function (layer) {
				var options = L.extend({}, layer.options);
				return layer._url && !options.url
					? new layer.constructor(layer._url, options)
					: new layer.constructor(options);
			}
		}
	];

	function cloneLayer(layer) {
		for (var i = 0; i < layerCloners.length; i++) {
			var cloner = layerCloners[i];
			if (!cloner.test(layer)) { continue; }
			try {
				return cloner.clone(layer);
			} catch (e) {
				return null;
			}
		}
		return null;
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}

	function corners(rect) {
		return {
			nw: { x: rect.x, y: rect.y },
			ne: { x: rect.x + rect.width, y: rect.y },
			se: { x: rect.x + rect.width, y: rect.y + rect.height },
			sw: { x: rect.x, y: rect.y + rect.height }
		};
	}

	/* Intersection of the segment from the centre of `rect` towards `target`
	   with the border of `rect`. Returns the centre when target is inside. */
	function clipToRect(rect, target) {
		var cx = rect.x + rect.width / 2;
		var cy = rect.y + rect.height / 2;
		var dx = target.x - cx;
		var dy = target.y - cy;

		if (!dx && !dy) { return { x: cx, y: cy }; }

		var scaleX = dx ? (rect.width / 2) / Math.abs(dx) : Infinity;
		var scaleY = dy ? (rect.height / 2) / Math.abs(dy) : Infinity;
		var scale = Math.min(scaleX, scaleY);

		if (scale >= 1) { return null; } // target sits inside the panel
		return { x: cx + dx * scale, y: cy + dy * scale };
	}

	/* The two box/panel corner pairs that form a trapezoid between the shapes. */
	function frustumPairs(boxRect, panelRect) {
		var dx = (panelRect.x + panelRect.width / 2) - (boxRect.x + boxRect.width / 2);
		var dy = (panelRect.y + panelRect.height / 2) - (boxRect.y + boxRect.height / 2);
		var horizontal = Math.abs(dx) / (boxRect.width + panelRect.width) >=
			Math.abs(dy) / (boxRect.height + panelRect.height);

		var box = corners(boxRect);
		var panel = corners(panelRect);

		if (horizontal) {
			return dx >= 0
				? [[box.ne, panel.nw], [box.se, panel.sw]]
				: [[box.nw, panel.ne], [box.sw, panel.se]];
		}
		return dy >= 0
			? [[box.sw, panel.nw], [box.se, panel.ne]]
			: [[box.nw, panel.sw], [box.ne, panel.se]];
	}

	/* Panel geometry for a resize drag from `dir`, given the drag delta. */
	function resizeRect(dir, start, dx, dy, minWidth, minHeight) {
		var out = { width: start.width, height: start.height, left: start.left, top: start.top };

		if (dir.indexOf('e') !== -1) {
			out.width = Math.max(minWidth, start.width + dx);
		} else if (dir.indexOf('w') !== -1) {
			out.width = Math.max(minWidth, start.width - dx);
			out.left = start.left + start.width - out.width;
		}

		if (dir.indexOf('s') !== -1) {
			out.height = Math.max(minHeight, start.height + dy);
		} else if (dir.indexOf('n') !== -1) {
			out.height = Math.max(minHeight, start.height - dy);
			out.top = start.top + start.height - out.height;
		}

		return out;
	}

	var DetailView = L.Evented.extend({

		options: {
			title: 'Detail',
			label: null,
			width: 320,
			height: 240,
			minWidth: 160,
			minHeight: 120,
			zoomOffset: 0,
			// Keep the source rectangle in step with the detail map viewport.
			syncBounds: true,
			connector: true,
			connectorType: 'leader',
			rectangleStyle: {
				color: '#000',
				weight: 2,
				fillColor: '#000',
				fillOpacity: 0.05,
				dashArray: '6 4'
			},
			connectorStyle: {
				color: '#000',
				weight: 2,
				dashArray: '6 4'
			},
			detailMapOptions: {
				attributionControl: false
			},
			zoomControl: false,
			scaleBar: false,
			// Inset zoom is pinned to parent zoom + this offset when set.
			lockZoom: null,
			dimWhenOffscreen: true,
			// Restore state: { left, top, width, height } and { center, zoom }
			panel: null,
			view: null,
			// function(parentMap) -> array of layers to add to the detail map
			createLayers: null,
			// Mirror layers added to / removed from the parent map while the view is open.
			syncLayers: true,
			// function(detailMap, detailView) - attach your own controls/handlers here
			onDetailMap: null
		},

		initialize: function (map, bounds, options) {
			L.setOptions(this, options);

			this._map = map;
			this._bounds = L.latLngBounds(bounds);
			this._container = map.getContainer();

			this._createRectangle();
			this._createPanel();
			this._createDetailMap();
			this._createConnector();
			this.setLabel(this.options.label);

			this._onParentViewChange = L.Util.bind(this._refreshOverlays, this);
			map.on('move zoom moveend zoomend resize', this._onParentViewChange);

			if (this.options.lockZoom !== null) { this.setZoomLock(this.options.lockZoom); }

			this._refreshOverlays();

			if (this.options.onDetailMap) { this.options.onDetailMap(this._detailMap, this); }
			this.fire('mapcreate', { detailMap: this._detailMap });
			map.fire('detailview:mapcreate', { detailView: this, detailMap: this._detailMap });
		},

		/* ------------------------------------------------------------------ */
		/* public API                                                          */
		/* ------------------------------------------------------------------ */

		getDetailMap: function () {
			return this._detailMap;
		},

		getBounds: function () {
			return this._bounds;
		},

		getTitle: function () {
			return this._title;
		},

		getLabel: function () {
			return this._label;
		},

		/** Show a short key (e.g. "A") on the box and in the panel header. */
		setLabel: function (label) {
			this._label = label || null;
			this._labelEl.textContent = this._label || '';
			this._labelEl.style.display = this._label ? '' : 'none';

			if (!this._label) {
				if (this._labelMarker) {
					this._map.removeLayer(this._labelMarker);
					this._labelMarker = null;
				}
				return this;
			}

			var icon = L.divIcon({ className: 'ldv-box-label', html: this._label, iconSize: [20, 20] });
			if (this._labelMarker) {
				this._labelMarker.setIcon(icon);
			} else {
				this._labelMarker = L.marker(this._bounds.getNorthWest(), {
					icon: icon,
					interactive: false,
					keyboard: false
				});
				this._labelMarker._ldvInternal = true;
				this._labelMarker.addTo(this._map);
			}
			return this;
		},

		setTitle: function (title) {
			this._title = title;
			this._titleEl.textContent = title;
			this.fire('titlechange', { title: title });
			return this;
		},

		/** Put the title into in-place edit mode. */
		editTitle: function () {
			if (this._editingTitle) { return this; }
			this._editingTitle = true;
			this._titleEl.contentEditable = 'true';
			L.DomUtil.addClass(this._titleEl, 'ldv-title-editing');
			this._titleEl.focus();

			var range = document.createRange();
			range.selectNodeContents(this._titleEl);
			var selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			return this;
		},

		setSize: function (width, height) {
			this._panel.style.width = Math.max(this.options.minWidth, width) + 'px';
			this._panel.style.height = Math.max(this.options.minHeight, height) + 'px';
			this._detailMap.invalidateSize({ animate: false });
			this._updateConnector();
			return this;
		},

		/** Show or hide the inset map's zoom control. Omit `show` to toggle. */
		toggleZoomControl: function (show) {
			var visible = show === undefined ? !this._zoomControlVisible : !!show;
			if (visible === this._zoomControlVisible) { return this; }

			this._zoomControlVisible = visible;
			if (visible) {
				this._zoomControl.addTo(this._detailMap);
			} else {
				this._zoomControl.remove();
			}

			if (visible) {
				L.DomUtil.addClass(this._zoomBtn, 'ldv-btn-active');
			} else {
				L.DomUtil.removeClass(this._zoomBtn, 'ldv-btn-active');
			}

			this.fire('zoomcontroltoggle', { visible: visible });
			return this;
		},

		/** Pin the inset zoom to `parent zoom + offset`; pass null to unpin. */
		setZoomLock: function (offset) {
			if (this._zoomLockHandler) {
				this._map.off('zoomend', this._zoomLockHandler, this);
				this._zoomLockHandler = null;
			}

			this._zoomLock = offset === null || offset === undefined ? null : offset;
			if (this._zoomLock === null) { return this; }

			this._zoomLockHandler = function () {
				this._detailMap.setZoom(this._map.getZoom() + this._zoomLock, { animate: false });
			};
			this._map.on('zoomend', this._zoomLockHandler, this);
			this._zoomLockHandler();
			return this;
		},

		getZoomLock: function () {
			return this._zoomLock === undefined ? null : this._zoomLock;
		},

		/** Re-clone the parent map's layers into the inset. */
		refreshLayers: function () {
			var detailMap = this._detailMap;
			Object.keys(this._layerClones || {}).forEach(function (id) {
				detailMap.removeLayer(this._layerClones[id]);
			}, this);

			this._addLayers();
			return this;
		},

		/** Raise this panel above any other detail views. */
		bringToFront: function () {
			this._panel.style.zIndex = ++topPanelZIndex;
			return this;
		},

		/** Serialisable state; pass back through `L.Control.DetailView#fromJSON`. */
		toJSON: function () {
			var b = this._bounds;
			var center = this._detailMap.getCenter();

			return {
				bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]],
				title: this._title,
				label: this._label,
				zoomControl: this._zoomControlVisible,
				lockZoom: this.getZoomLock(),
				panel: {
					left: parseFloat(this._panel.style.left) || 0,
					top: parseFloat(this._panel.style.top) || 0,
					width: this._panel.offsetWidth,
					height: this._panel.offsetHeight
				},
				view: {
					center: [center.lat, center.lng],
					zoom: this._detailMap.getZoom()
				}
			};
		},

		remove: function () {
			this._map.off('move zoom moveend zoomend resize', this._onParentViewChange);
			this._map.off('layeradd', this._onParentLayerAdd, this);
			this._map.off('layerremove', this._onParentLayerRemove, this);
			this.setZoomLock(null);
			this._detailMap.remove();
			L.DomUtil.remove(this._panel);
			if (this._svg) { L.DomUtil.remove(this._svg); }
			if (this._labelMarker) { this._map.removeLayer(this._labelMarker); }
			this._map.removeLayer(this._rect);
			this.fire('remove');
			return this;
		},

		/* ------------------------------------------------------------------ */
		/* source rectangle                                                    */
		/* ------------------------------------------------------------------ */

		_createRectangle: function () {
			var style = L.extend({ className: 'ldv-box' }, this.options.rectangleStyle);
			this._rect = L.rectangle(this._bounds, style);
			this._rect._ldvInternal = true;
			this._rect.addTo(this._map);

			var el = this._rect.getElement && this._rect.getElement();
			if (el) {
				L.DomEvent.on(el, POINTER.down, this._onRectDragStart, this);
			} else {
				// canvas renderer: no DOM element to bind to
				this._rect.on('mousedown', function (e) { this._onRectDragStart(e.originalEvent); }, this);
			}
		},

		_onRectDragStart: function (e) {
			L.DomEvent.stop(e);
			this._map.dragging.disable();
			this._dragOrigin = this._map.mouseEventToLatLng(e);
			L.DomEvent.on(document, POINTER.move, this._onRectDrag, this);
			L.DomEvent.on(document, POINTER.up, this._onRectDragEnd, this);
		},

		_onRectDrag: function (e) {
			var latlng = this._map.mouseEventToLatLng(e);
			var dLat = latlng.lat - this._dragOrigin.lat;
			var dLng = latlng.lng - this._dragOrigin.lng;
			this._dragOrigin = latlng;

			var b = this._bounds;
			this._setBounds(L.latLngBounds(
				[b.getSouth() + dLat, b.getWest() + dLng],
				[b.getNorth() + dLat, b.getEast() + dLng]
			));

			this._syncing = true;
			this._detailMap.panTo(this._bounds.getCenter(), { animate: false });
			this._syncing = false;
		},

		_onRectDragEnd: function () {
			this._map.dragging.enable();
			L.DomEvent.off(document, POINTER.move, this._onRectDrag, this);
			L.DomEvent.off(document, POINTER.up, this._onRectDragEnd, this);
		},

		_setBounds: function (bounds) {
			this._bounds = bounds;
			this._rect.setBounds(bounds);
			if (this._labelMarker) { this._labelMarker.setLatLng(bounds.getNorthWest()); }
			this._updateConnector();
			this.fire('boundschange', { bounds: bounds });
		},

		/* ------------------------------------------------------------------ */
		/* panel                                                               */
		/* ------------------------------------------------------------------ */

		_createPanel: function () {
			var panel = this._panel = L.DomUtil.create('div', 'ldv-panel', this._container);
			var saved = this.options.panel;
			panel.style.width = (saved ? saved.width : this.options.width) + 'px';
			panel.style.height = (saved ? saved.height : this.options.height) + 'px';
			panel.style.zIndex = ++topPanelZIndex;

			var header = L.DomUtil.create('div', 'ldv-header', panel);
			this._labelEl = L.DomUtil.create('span', 'ldv-label', header);
			this._labelEl.style.display = 'none';
			this._titleEl = L.DomUtil.create('span', 'ldv-title', header);
			this._title = this.options.title;
			this._titleEl.textContent = this._title;
			this._titleEl.title = 'Double-click to rename';
			this._titleEl.setAttribute('role', 'textbox');

			var actions = L.DomUtil.create('div', 'ldv-actions', header);
			this._renameBtn = this._createButton(actions, 'ldv-btn-rename', 'Rename detail view', '\u270e');
			this._zoomBtn = this._createButton(actions, 'ldv-btn-zoom', 'Toggle zoom control', '\u00b1');
			this._closeBtn = this._createButton(actions, 'ldv-btn-close', 'Close detail view', '\u00d7');

			this._mapEl = L.DomUtil.create('div', 'ldv-map', panel);
			this._createResizeHandles(panel);

			L.DomEvent.disableClickPropagation(panel);
			L.DomEvent.disableScrollPropagation(panel);

			// capture phase: header/resize handlers stop propagation
			panel.addEventListener(POINTER.down, L.Util.bind(this.bringToFront, this), true);
			L.DomEvent.on(this._renameBtn, 'click', this.editTitle, this);
			L.DomEvent.on(this._zoomBtn, 'click', function () { this.toggleZoomControl(); }, this);
			L.DomEvent.on(this._closeBtn, 'click', this.remove, this);
			L.DomEvent.on(header, POINTER.down, this._onPanelDragStart, this);
			L.DomEvent.on(this._titleEl, 'dblclick', this.editTitle, this);
			L.DomEvent.on(this._titleEl, 'keydown', this._onTitleKeyDown, this);
			L.DomEvent.on(this._titleEl, 'blur', this._commitTitle, this);

			if (saved) {
				this._setPanelPosition(saved.left, saved.top);
			} else {
				this._positionPanel();
			}
		},

		_createResizeHandles: function (panel) {
			EDGES.forEach(function (dir) {
				var handle = L.DomUtil.create('div', 'ldv-resize ldv-resize-' + dir, panel);
				L.DomEvent.on(handle, POINTER.down, function (e) {
					this._onResizeStart(e, dir);
				}, this);
			}, this);
		},

		_createButton: function (parent, className, title, text) {
			var btn = L.DomUtil.create('button', 'ldv-btn ' + className, parent);
			btn.type = 'button';
			btn.title = title;
			btn.setAttribute('aria-label', title);
			btn.textContent = text;
			return btn;
		},

		/* Place the panel next to the source box, inside the map container. */
		_positionPanel: function () {
			var size = this._map.getSize();
			var ne = this._map.latLngToContainerPoint(this._bounds.getNorthEast());
			var sw = this._map.latLngToContainerPoint(this._bounds.getSouthWest());

			var left = ne.x + 40;
			if (left + this.options.width > size.x - 8) {
				left = sw.x - this.options.width - 40;
			}
			var top = ne.y;

			this._setPanelPosition(left, top);
		},

		_setPanelPosition: function (left, top) {
			var size = this._map.getSize();
			left = clamp(left, 8, Math.max(8, size.x - this._panel.offsetWidth - 8));
			top = clamp(top, 8, Math.max(8, size.y - this._panel.offsetHeight - 8));
			this._panel.style.left = left + 'px';
			this._panel.style.top = top + 'px';
			this._updateConnector();
		},

		_onTitleKeyDown: function (e) {
			L.DomEvent.stopPropagation(e);
			if (e.key === 'Enter') {
				L.DomEvent.preventDefault(e);
				this._titleEl.blur();
			} else if (e.key === 'Escape') {
				this._titleEl.textContent = this._title;
				this._titleEl.blur();
			}
		},

		_commitTitle: function () {
			if (!this._editingTitle) { return; }
			this._editingTitle = false;
			this._titleEl.contentEditable = 'false';
			L.DomUtil.removeClass(this._titleEl, 'ldv-title-editing');
			window.getSelection().removeAllRanges();

			var title = this._titleEl.textContent.trim();
			this.setTitle(title || this._title);
		},

		_onPanelDragStart: function (e) {
			if (e.target.tagName === 'BUTTON' || this._editingTitle) { return; }
			L.DomEvent.stop(e);
			this._panelDrag = {
				x: e.clientX,
				y: e.clientY,
				left: parseFloat(this._panel.style.left) || 0,
				top: parseFloat(this._panel.style.top) || 0
			};
			L.DomEvent.on(document, POINTER.move, this._onPanelDrag, this);
			L.DomEvent.on(document, POINTER.up, this._onPanelDragEnd, this);
		},

		_onPanelDrag: function (e) {
			var d = this._panelDrag;
			this._setPanelPosition(d.left + e.clientX - d.x, d.top + e.clientY - d.y);
		},

		_onPanelDragEnd: function () {
			L.DomEvent.off(document, POINTER.move, this._onPanelDrag, this);
			L.DomEvent.off(document, POINTER.up, this._onPanelDragEnd, this);
		},

		_onResizeStart: function (e, dir) {
			L.DomEvent.stop(e);
			this._resizeDrag = {
				dir: dir,
				x: e.clientX,
				y: e.clientY,
				width: this._panel.offsetWidth,
				height: this._panel.offsetHeight,
				left: parseFloat(this._panel.style.left) || 0,
				top: parseFloat(this._panel.style.top) || 0
			};
			L.DomUtil.addClass(this._panel, 'ldv-resizing');
			L.DomEvent.on(document, POINTER.move, this._onResize, this);
			L.DomEvent.on(document, POINTER.up, this._onResizeEnd, this);
		},

		_onResize: function (e) {
			var d = this._resizeDrag;
			var next = resizeRect(
				d.dir, d, e.clientX - d.x, e.clientY - d.y,
				this.options.minWidth, this.options.minHeight
			);

			this._panel.style.width = next.width + 'px';
			this._panel.style.height = next.height + 'px';
			this._setPanelPosition(next.left, next.top);
			this._detailMap.invalidateSize({ animate: false });
		},

		_onResizeEnd: function () {
			L.DomUtil.removeClass(this._panel, 'ldv-resizing');
			L.DomEvent.off(document, POINTER.move, this._onResize, this);
			L.DomEvent.off(document, POINTER.up, this._onResizeEnd, this);
			this.fire('panelresize', {
				width: this._panel.offsetWidth,
				height: this._panel.offsetHeight
			});
		},

		/* ------------------------------------------------------------------ */
		/* detail map                                                          */
		/* ------------------------------------------------------------------ */

		_createDetailMap: function () {
			var inherited = {};
			INHERITED_MAP_OPTIONS.forEach(function (name) {
				if (this._map.options[name] !== undefined) {
					inherited[name] = this._map.options[name];
				}
			}, this);

			var opts = L.extend(inherited, this.options.detailMapOptions, { zoomControl: false });
			var detailMap = this._detailMap = L.map(this._mapEl, opts);

			this._copyPanes();

			this._zoomControl = L.control.zoom();
			this._zoomControlVisible = false;
			this.toggleZoomControl(this.options.zoomControl);

			if (this.options.scaleBar) {
				L.control.scale({ imperial: false }).addTo(detailMap);
			}

			this._addLayers();

			if (this.options.view) {
				detailMap.setView(this.options.view.center, this.options.view.zoom, { animate: false });
			} else {
				detailMap.fitBounds(this._bounds, { animate: false });
				if (this.options.zoomOffset) {
					detailMap.setZoom(detailMap.getZoom() + this.options.zoomOffset, { animate: false });
				}
			}

			if (this.options.syncBounds) {
				detailMap.on('move zoom', this._onDetailViewChange, this);
				this._onDetailViewChange();
			}
		},

		_addLayers: function () {
			this._layerClones = {};

			if (this.options.createLayers) {
				this.options.createLayers(this._map).forEach(function (layer) {
					this._detailMap.addLayer(layer);
				}, this);
				return;
			}

			this._map.eachLayer(this._mirrorLayer, this);

			if (this.options.syncLayers && !this._layerSyncBound) {
				this._layerSyncBound = true;
				this._map.on('layeradd', this._onParentLayerAdd, this);
				this._map.on('layerremove', this._onParentLayerRemove, this);
			}
		},

		_onParentLayerAdd: function (e) {
			this._mirrorLayer(e.layer);
		},

		_onParentLayerRemove: function (e) {
			var id = L.Util.stamp(e.layer);
			var clone = this._layerClones[id];

			if (clone) {
				this._detailMap.removeLayer(clone);
				delete this._layerClones[id];
			}
		},

		/* Clone one parent layer into the inset, keyed by the parent layer's id. */
		_mirrorLayer: function (layer) {
			if (layer._ldvInternal || layer instanceof L.LayerGroup) { return; }

			var id = L.Util.stamp(layer);
			if (this._layerClones[id]) { return; }

			var clone = cloneLayer(layer);
			if (!clone) { return; }

			if (clone.options && clone.options.pane) {
				this._copyPanes();
				if (!this._detailMap.getPane(clone.options.pane)) { clone.options.pane = undefined; }
			}

			this._layerClones[id] = clone;
			this._detailMap.addLayer(clone);
		},

		/* Non-default panes have to exist before cloned layers can use them. */
		_copyPanes: function () {
			var parentPanes = this._map._panes || {};

			Object.keys(parentPanes).forEach(function (name) {
				if (DEFAULT_PANES.indexOf(name) !== -1 || this._detailMap.getPane(name)) { return; }

				var source = parentPanes[name];
				var pane = this._detailMap.createPane(name);
				pane.className = source.className;
				pane.style.zIndex = source.style.zIndex ||
					window.getComputedStyle(source).zIndex;
			}, this);
		},

		_onDetailViewChange: function () {
			if (this._syncing) { return; }
			this._setBounds(this._detailMap.getBounds());
		},

		/* ------------------------------------------------------------------ */
		/* connector line                                                      */
		/* ------------------------------------------------------------------ */

		_createConnector: function () {
			if (!this.options.connector) { return; }

			var ns = 'http://www.w3.org/2000/svg';
			var svg = this._svg = document.createElementNS(ns, 'svg');
			svg.setAttribute('class', 'ldv-connector');

			var style = this.options.connectorStyle;
			var count = this.options.connectorType === 'frustum' ? 2 : 1;

			this._lines = [];
			for (var i = 0; i < count; i++) {
				var line = document.createElementNS(ns, 'line');
				line.setAttribute('stroke', style.color);
				line.setAttribute('stroke-width', style.weight);
				if (style.dashArray) { line.setAttribute('stroke-dasharray', style.dashArray); }
				svg.appendChild(line);
				this._lines.push(line);
			}

			this._container.appendChild(svg);
		},

		_refreshOverlays: function () {
			this._updateConnector();
			this._updateOffscreenState();
		},

		/* Dim the panel while its box is outside the visible map. */
		_updateOffscreenState: function () {
			if (!this.options.dimWhenOffscreen) { return; }

			var size = this._map.getSize();
			var nw = this._map.latLngToContainerPoint(this._bounds.getNorthWest());
			var se = this._map.latLngToContainerPoint(this._bounds.getSouthEast());
			var visible = se.x > 0 && nw.x < size.x && se.y > 0 && nw.y < size.y;

			if (visible) {
				L.DomUtil.removeClass(this._panel, 'ldv-panel-offscreen');
			} else {
				L.DomUtil.addClass(this._panel, 'ldv-panel-offscreen');
			}
		},

		_setLines: function (segments) {
			this._lines.forEach(function (line, i) {
				var seg = segments[i];
				if (!seg) {
					line.style.display = 'none';
					return;
				}
				line.style.display = '';
				line.setAttribute('x1', seg[0].x);
				line.setAttribute('y1', seg[0].y);
				line.setAttribute('x2', seg[1].x);
				line.setAttribute('y2', seg[1].y);
			});
		},

		_updateConnector: function () {
			if (!this._svg) { return; }

			var rect = {
				x: parseFloat(this._panel.style.left) || 0,
				y: parseFloat(this._panel.style.top) || 0,
				width: this._panel.offsetWidth,
				height: this._panel.offsetHeight
			};

			var nw = this._map.latLngToContainerPoint(this._bounds.getNorthWest());
			var se = this._map.latLngToContainerPoint(this._bounds.getSouthEast());
			var boxRect = { x: nw.x, y: nw.y, width: se.x - nw.x, height: se.y - nw.y };

			// aim at the box edge facing the panel, not the box centre
			var target = clipToRect(boxRect, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
			var start = target && clipToRect(rect, target);

			if (!start) {
				this._svg.style.display = 'none';
				return;
			}
			this._svg.style.display = '';

			this._setLines(this.options.connectorType === 'frustum'
				? frustumPairs(boxRect, rect)
				: [[start, target]]);
		}
	});

	/* -------------------------------------------------------------------- */
	/* control                                                               */
	/* -------------------------------------------------------------------- */

	var DetailViewControl = L.Control.extend({

		options: {
			position: 'topleft',
			title: 'Draw a detail view box',
			autoLabel: true,
			detailViewOptions: {}
		},

		onAdd: function (map) {
			this._map = map;
			this._views = [];
			this._labelIndex = 0;

			var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control ldv-control');
			var link = this._link = L.DomUtil.create('a', 'ldv-control-button', container);
			link.href = '#';
			link.title = this.options.title;
			link.setAttribute('role', 'button');
			link.innerHTML = '<span aria-hidden="true">\u2b1a</span>';

			L.DomEvent.disableClickPropagation(container);
			L.DomEvent.on(link, 'click', L.DomEvent.stop);
			L.DomEvent.on(link, 'click', this.toggle, this);

			return container;
		},

		onRemove: function () {
			this.disableDrawing();
			this._views.slice().forEach(function (view) { view.remove(); });
		},

		getDetailViews: function () {
			return this._views.slice();
		},

		/** State of every detail view, restorable with `fromJSON`. */
		toJSON: function () {
			return this._views.map(function (view) { return view.toJSON(); });
		},

		fromJSON: function (state) {
			state = state || [];
			this._labelIndex = Math.max(this._labelIndex, state.length);

			return state.map(function (item) {
				return this.addDetailView(L.latLngBounds(item.bounds), {
					title: item.title,
					label: item.label,
					zoomControl: item.zoomControl,
					lockZoom: item.lockZoom,
					panel: item.panel,
					view: item.view
				});
			}, this);
		},

		toggle: function () {
			if (this._drawing) { this.disableDrawing(); } else { this.enableDrawing(); }
		},

		enableDrawing: function () {
			if (this._drawing) { return; }
			this._drawing = true;
			L.DomUtil.addClass(this._link, 'ldv-control-active');
			L.DomUtil.addClass(this._map.getContainer(), 'ldv-drawing');
			this._map.dragging.disable();
			L.DomEvent.on(this._map.getContainer(), POINTER.down, this._onDrawStart, this);
			L.DomEvent.on(document, 'keydown', this._onDrawKeyDown, this);
			this._map.fire('detailview:drawstart');
		},

		disableDrawing: function () {
			if (!this._drawing) { return; }
			this._drawing = false;
			L.DomUtil.removeClass(this._link, 'ldv-control-active');
			L.DomUtil.removeClass(this._map.getContainer(), 'ldv-drawing');
			this._map.dragging.enable();
			L.DomEvent.off(this._map.getContainer(), POINTER.down, this._onDrawStart, this);
			L.DomEvent.off(document, 'keydown', this._onDrawKeyDown, this);
			this._cleanupPreview();
			this._map.fire('detailview:drawend');
		},

		_onDrawKeyDown: function (e) {
			if (e.key === 'Escape') { this.disableDrawing(); }
		},

		_onDrawStart: function (e) {
			if (e.target.closest && e.target.closest('.leaflet-control, .ldv-panel')) { return; }
			L.DomEvent.stop(e);

			this._start = this._end = this._map.mouseEventToLatLng(e);
			this._preview = L.rectangle(L.latLngBounds(this._start, this._start), {
				color: '#000',
				weight: 2,
				dashArray: '6 4',
				fillOpacity: 0.05,
				interactive: false
			});
			this._preview._ldvInternal = true;
			this._preview.addTo(this._map);

			L.DomEvent.on(document, POINTER.move, this._onDrawMove, this);
			L.DomEvent.on(document, POINTER.up, this._onDrawEnd, this);
		},

		_onDrawMove: function (e) {
			this._end = this._map.mouseEventToLatLng(e);
			this._preview.setBounds(L.latLngBounds(this._start, this._end));
		},

		_onDrawEnd: function () {
			var bounds = L.latLngBounds(this._start, this._end);
			var size = this._map.latLngToContainerPoint(bounds.getNorthEast())
				.subtract(this._map.latLngToContainerPoint(bounds.getSouthWest()));

			this.disableDrawing();

			if (Math.abs(size.x) < 8 || Math.abs(size.y) < 8) { return; }

			this.addDetailView(bounds);
		},

		addDetailView: function (bounds, options) {
			var opts = L.extend({}, this.options.detailViewOptions, options);
			if (this.options.autoLabel && opts.label === undefined) {
				opts.label = this._nextLabel();
			}

			var view = new DetailView(this._map, bounds, opts);

			this._views.push(view);
			view.on('remove', function () {
				var i = this._views.indexOf(view);
				if (i !== -1) { this._views.splice(i, 1); }
			}, this);

			this._map.fire('detailview:create', { detailView: view });
			return view;
		},

		/* A, B, ... Z, A1, B1, ... */
		_nextLabel: function () {
			var i = this._labelIndex++;
			var letter = String.fromCharCode(65 + (i % 26));
			var cycle = Math.floor(i / 26);
			return cycle ? letter + cycle : letter;
		},

		_cleanupPreview: function () {
			L.DomEvent.off(document, POINTER.move, this._onDrawMove, this);
			L.DomEvent.off(document, POINTER.up, this._onDrawEnd, this);
			if (this._preview) {
				this._map.removeLayer(this._preview);
				this._preview = null;
			}
		}
	});

	L.DetailView = DetailView;
	L.DetailView.Util = {
		clipToRect: clipToRect,
		frustumPairs: frustumPairs,
		resizeRect: resizeRect
	};

	/** Teach the inset how to clone an app-specific layer class. */
	L.DetailView.registerLayerCloner = function (test, clone) {
		layerCloners.unshift({ test: test, clone: clone });
	};
	L.detailView = function (map, bounds, options) {
		return new DetailView(map, bounds, options);
	};

	L.Control.DetailView = DetailViewControl;
	L.control.detailView = function (options) {
		return new DetailViewControl(options);
	};

	return DetailViewControl;
}));
