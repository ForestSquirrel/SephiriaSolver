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

## Merging

Two tablets can be merged in the tool's merge dialog. The result combines both sources'
`effects` (baked at the chosen rotations) and `lineBuff`s, and is non-rotatable if either
source was.

`activationPosition` is inherited as follows, treating a missing field as "no restriction":

- Neither source has one → the merged tablet has none.
- Only one source has one → it is inherited as-is.
- Both are identical → inherited as-is.
- One set is included in the other (e.g. `["left","right"]` + `["left"]`) → the **narrower**
  set is inherited (`["left"]`).
- Any other combination — disjoint (`["top"]` + `["left"]`) or partially overlapping — is
  **not supported**: the in-game behavior is unconfirmed, so the merge dialog blocks it with
  an explanatory message.

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