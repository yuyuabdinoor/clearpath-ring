# Doorway-access evaluation and Frigate reference

Status: test plan, **not** completed evaluation. No real-image localization results have been recorded yet. Do not present the cases below as model accuracy evidence.

## What to learn from Frigate

The [Frigate source](https://github.com/blakeblackshear/frigate) separates object tracking, zone membership, and alert classification. Its [zone editor](https://github.com/blakeblackshear/frigate/blob/dev/web/src/components/settings/ZoneEditPane.tsx) stores normalized coordinates. Its [tracked-object code](https://github.com/blakeblackshear/frigate/blob/dev/frigate/track/tracked_object.py) checks whether the bottom-center of an object box lies inside a polygon and uses multi-frame inertia before zone entry. Its [review maintainer](https://github.com/blakeblackshear/frigate/blob/dev/frigate/review/maintainer.py) promotes only qualifying object labels in required zones to alerts. The [zone transition tests](https://github.com/blakeblackshear/frigate/blob/dev/frigate/test/test_tracked_object_zones.py) cover lost detections and repeated frames.

EntryHalo should adopt the separation of concerns and transition tests, not Frigate's geometry rule or NVR architecture. A parcel can intrude into an access route even when the box bottom-center is outside it. A stationary parcel can remain consequential after the delivery motion ends. Ring Playground provides WHEP video, not Frigate's RTSP pipeline. Frigate's MIT license permits reuse with its copyright notice, but this project currently copies no Frigate code.

## Evaluation protocol

Before tuning the visual prompt, collect consented or appropriately licensed entrance frames and label each with: source, capture time, device/scenario, access-zone coordinates, all relevant movable objects, visibility limitations, expected state, and why. Do not publish private resident images. Keep synthetic screenshots, Ring Playground frames, and independent photographs in separate groups. Freeze labels before running the model.

For each frame, record raw structured model output, schema-validity result, app state, overlap ratios, analysis latency, and whether the expected state matched. Count false-clear results separately; they are more consequential than a review decision. Model-reported confidence is not measured reliability. Have a human adjudicate ambiguous cases before scoring.

| ID | Entrance condition to source | Expected policy outcome |
| --- | --- | --- |
| F01 | Well-lit empty protected zone | `ZONE CLEAR` if whole zone visible |
| F02 | One parcel wholly outside zone | `ZONE CLEAR` only after whole-zone check |
| F03 | One parcel wholly inside zone | `OBSTRUCTION DETECTED` |
| F04 | Parcel overlaps less than the 10% object-area threshold | `REVIEW NEEDED` |
| F05 | Parcel overlaps at or above the threshold | `OBSTRUCTION DETECTED` |
| F06 | Two parcels: one outside and one inside | `OBSTRUCTION DETECTED`; outside parcel must not mask inside parcel |
| F07 | Two parcels both outside | `ZONE CLEAR` only after whole-zone check |
| F08 | Movable bag or box, not a labeled parcel, inside | `OBSTRUCTION DETECTED` if confidently localized |
| F09 | Fixed porch post near zone | No movable-object alert; review if it hides zone |
| F10 | Person temporarily occluding zone | `REVIEW NEEDED`, not a parcel alert or clear claim |
| F11 | Low-light entrance with uncertain visibility | `REVIEW NEEDED` |
| F12 | Glare or rain obscures the protected zone | `REVIEW NEEDED` |
| F13 | Parcel partly cut off by image edge | `REVIEW NEEDED` unless bounds and overlap are reliable |
| F14 | Parcel visually similar to doormat or step | Adjudicate first; likely `REVIEW NEEDED` if ambiguous |
| F15 | Before/after pair: parcel present, then absent | Obstruction then newer clear evidence; label replayed footage honestly |
| F16 | Before/after pair: parcel remains | Obstruction, then obstruction again; no removal update |

Separate temporal checks: frozen video must refuse capture; missing video must show `CAMERA UNAVAILABLE`; a selected-device motion event must invalidate older analysis; unrelated or replayed events must not. These are application tests, not visual-model accuracy cases.

## Ship gate

1. Record actual results for F01–F16, including misses and uncertain outputs. Replace any unavailable scene with a disclosed equivalent; do not fabricate a result.
2. Run one authenticated Ring Playground sequence: start WHEP, show advancing frames, capture, analyze, display state, recheck with a newer frame. Record whether the event is `on_demand` or motion; do not call it a package-classified Ring event without evidence.
3. Test the public demo behind access control before sharing it. Browser desktop notifications require an open page and consent. There is no courier voice or background push delivery.
4. Record the submission video only from verified behavior. Label sample mode as synthetic.
