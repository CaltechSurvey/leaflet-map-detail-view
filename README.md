# Leaflet.DetailView

Draw a box on a Leaflet map to open a zoomable inset "detail view" of that area. The inset
is a real Leaflet map in a draggable/resizable panel, connected to the source box by a
leader line.

## Usage

```html
<link rel="stylesheet" href="src/leaflet-detail-view.css">
<script src="src/leaflet-detail-view.js"></script>
```

```js
L.control.detailView({ detailViewOptions: { width: 340, height: 260 } }).addTo(map);
```

Click the control button, then drag a box on the map.

Create one programmatically:

```js
var view = L.detailView(map, [[51.50, -0.10], [51.51, -0.08]], { title: 'Site A' });
view.toggleZoomControl(false);
```

## Interactions

| Action | How |
| --- | --- |
| Create a detail view | Click the control, drag a box (Escape cancels) |
| Move the source box | Drag the dashed rectangle |
| Move / resize the panel | Drag the header / any edge or corner |
| Raise an overlapping panel | Click anywhere on it |
| Zoom the detail | Use the inset map's zoom controls or wheel |
| Rename the detail view | Click `✎`, or double-click the title; Enter commits, Escape cancels |
| Show / hide the inset zoom control | Click `±` |
| Close the detail view | Click `×` |

## Options

`L.Control.DetailView`

| Option | Default | Description |
| --- | --- | --- |
| `position` | `'topleft'` | Control position |
| `title` | `'Draw a detail view box'` | Button tooltip |
| `autoLabel` | `true` | Label new views `A`, `B`, `C`, ... |
| `detailViewOptions` | `{}` | Options passed to each `L.DetailView` |

`L.DetailView`

| Option | Default | Description |
| --- | --- | --- |
| `title` | `'Detail'` | Panel title |
| `label` | `null` | Short key shown on the box and in the header |
| `width` / `height` | `320` / `240` | Initial panel size in px |
| `minWidth` / `minHeight` | `160` / `120` | Resize limits |
| `zoomOffset` | `0` | Extra zoom applied after fitting the box |
| `syncBounds` | `true` | Keep the source box matched to the inset viewport |
| `connector` | `true` | Draw the connector |
| `connectorType` | `'leader'` | `'leader'` (single line) or `'frustum'` (two corner-to-corner lines) |
| `rectangleStyle` / `connectorStyle` | black dashed | Styling |
| `zoomControl` | `false` | Whether the inset map starts with a zoom control |
| `scaleBar` | `false` | Add a scale bar to the inset map |
| `lockZoom` | `null` | Pin the inset zoom to `parent zoom + n` |
| `dimWhenOffscreen` | `true` | Fade the panel while its box is out of view |
| `panel` | `null` | Restore geometry: `{ left, top, width, height }` |
| `view` | `null` | Restore inset view: `{ center, zoom }` |
| `detailMapOptions` | `{ attributionControl: false }` | Options for the inset `L.Map`. `crs`, `minZoom`, `maxZoom`, `maxBounds` and `preferCanvas` are inherited from the parent map unless overridden |
| `createLayers` | `null` | `function(parentMap)` returning layers for the inset map. Defaults to cloning the parent's layers |
| `syncLayers` | `true` | Mirror layers added to / removed from the parent map while the view is open |
| `onDetailMap` | `null` | `function(detailMap, detailView)` called once the inset map exists — attach your own controls and handlers here |

## Layers in the inset

By default the plugin clones the parent map's layers: tile and WMS layers, image overlays,
markers, circles, polylines/polygons, and anything else with `toGeoJSON()`. Non-default
panes are recreated on the inset so layers keep their stacking order.

With `syncLayers` (on by default) layers added to or removed from the parent map after the
view is open are mirrored automatically. Clones are snapshots, so if you mutate a layer in
place (`setLatLngs`, `setStyle`, ...) call `view.refreshLayers()` to rebuild them.

To keep a layer out of the inset, give it `ldvIgnore: true`:

```js
L.marker(latlng, { ldvIgnore: true }).addTo(map);
```

The plugin's own box and label are created with `pmIgnore: true`, so Leaflet-Geoman will
not make them editable and they stay out of `map.pm` based exports.

For app-specific layer classes (Esri Leaflet, vector tiles, ...) either register a cloner:

```js
L.DetailView.registerLayerCloner(
	(layer) => layer instanceof L.esri.TiledMapLayer,
	(layer) => L.esri.tiledMapLayer({ url: layer.options.url })
);
```

or take full control with `createLayers`:

```js
L.control.detailView({
	detailViewOptions: {
		createLayers: () => [L.tileLayer(basemapUrl, { maxZoom: 22 })]
	}
}).addTo(map);
```

## Using your own tools in the inset

The inset is a separate `L.Map`, so controls and handlers bound to the parent map do not
apply to it. Wire them up per detail view:

```js
L.control.detailView({
	detailViewOptions: {
		onDetailMap: (detailMap) => {
			L.control.scale().addTo(detailMap);
			detailMap.on('click', onMapClick);
		}
	}
}).addTo(map);
```

For markup/draw tools, target the inset map but keep storing features on the **parent**
map — `syncLayers` then mirrors them straight back into the inset, and the markup survives
closing the panel:

```js
// Leaflet-Geoman
L.control.detailView({
	detailViewOptions: {
		onDetailMap: (detailMap) => {
			detailMap.pm.addControls({ drawControls: true, editControls: true });
			detailMap.on('pm:create', (e) => {
				detailMap.removeLayer(e.layer);
				e.layer.addTo(map);
			});
		}
	}
}).addTo(map);
```

```js
// Leaflet.draw
const drawnItems = new L.FeatureGroup().addTo(map);

detailMap.addControl(new L.Control.Draw({ edit: { featureGroup: drawnItems } }));
detailMap.on(L.Draw.Event.CREATED, (e) => drawnItems.addLayer(e.layer));
```

The same hook is available as the `mapcreate` event on a view and
`detailview:mapcreate` on the parent map.

## API

`L.DetailView`

- `getDetailMap()` – the inset `L.Map`
- `getBounds()` / `getTitle()` / `setTitle(title)` / `editTitle()` / `setSize(width, height)`
- `getLabel()` / `setLabel(label)`
- `toggleZoomControl(show)` – omit `show` to toggle
- `setZoomLock(offset)` / `getZoomLock()` – `null` unpins
- `refreshLayers()` – re-clone the parent map's layers
- `bringToFront()`
- `toJSON()`
- `remove()`

`L.Control.DetailView`

- `enableDrawing()` / `disableDrawing()` / `toggle()`
- `addDetailView(bounds, options)` / `getDetailViews()`
- `toJSON()` / `fromJSON(state)`

```js
localStorage.setItem('insets', JSON.stringify(detailControl.toJSON()));
detailControl.fromJSON(JSON.parse(localStorage.getItem('insets')));
```

Events on the detail view: `boundschange`, `panelresize`, `titlechange`, `zoomcontroltoggle`, `mapcreate`, `remove`.
Events on the map: `detailview:drawstart`, `detailview:drawend`, `detailview:create`, `detailview:mapcreate`.

## Development

```
npm test    # geometry unit tests (node:test)
npm run lint
npm start   # serve the demo
```

Then open `demo/index.html`.
