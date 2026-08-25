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
| `detailMapOptions` | `{ attributionControl: false }` | Options for the inset `L.Map` |
| `createLayers` | `null` | `function(parentMap)` returning layers for the inset map. Defaults to cloning the parent's tile and vector layers |

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

Events on the detail view: `boundschange`, `panelresize`, `titlechange`, `zoomcontroltoggle`, `remove`.
Events on the map: `detailview:drawstart`, `detailview:drawend`, `detailview:create`.

## Development

```
npm test    # geometry unit tests (node:test)
npm run lint
npm start   # serve the demo
```

Then open `demo/index.html`.
