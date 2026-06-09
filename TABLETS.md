# Tablets

**Tablets** are inventory grid items that modify the effects of neighboring items. Each tablet defines an area of influence (AOE) relative to its own grid position and applies a buff/debuff value to items within that area.

## Format — `tablets.json`

| Field | Type | Description |
|---|---|---|
| `id` | integer | Unique identifier |
| `name` | string | Display name |
| `disableRotate` | boolean *(optional, default `false`)* | If `true`, the tablet cannot be rotated by the player |
| `activationPosition` | string[] *(optional)* | Restricts which edge(s) of the inventory the tablet must be placed at to activate. Values: `"top"`, `"bottom"`, `"left"`, `"right"` |
| `lineBuff` | object[] *(optional)* | Buffs applied to an entire row, column, or diagonal |
| `effects` | tuple[] *(optional)* | Buffs applied to discrete cells relative to the tablet |

A tablet will have either `lineBuff`, `effects`, or both.

### `lineBuff` entry

| Field | Values | Description |
|---|---|---|
| `axis` | `"row"` `"column"` `"diagonal"` | Which axis the line runs along |
| `ref` | `"self"` `"top"` `"bottom"` `"left"` `"right"` | Which line relative to the grid |
| `buff` | integer | Modifier applied to all items on that line |

### `effects` entry

Each effect is a compact tuple **`[x, y, buff]`** where `x` and `y` are cell offsets from the tablet's position (positive x = right, positive y = up), and `buff` is the integer modifier. Positive values are buffs, negative are debuffs.

## Example

```json
{
  "id": 15,
  "name": "Shade",
  "disableRotate": true,
  "activationPosition": ["top"],
  "lineBuff": [
    { "axis": "row", "ref": "bottom", "buff": 1 }
  ]
}
```

```json
{
  "id": 14,
  "name": "Nurture",
  "effects": [
    [-1, 1, 1],
    [0,  1, 1],
    [1,  1, 1],
    [0, -1, -1],
    [0, -2, -1]
  ]
}
```