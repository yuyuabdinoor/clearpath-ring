# ClearPath MVP contract

ClearPath monitors a resident-defined access zone at an entrance. It reports what is visible in the latest usable Ring evidence; it does not certify accessibility, safety, legal clearance, or physical navigability.

## States

- `ZONE CLEAR`: no movable obstruction is visible inside the protected zone in the latest usable view.
- `OBSTRUCTION DETECTED`: a confidently localized object materially overlaps the protected zone.
- `REVIEW NEEDED`: evidence is stale, occluded, or below the configured confidence threshold.
- `CAMERA UNAVAILABLE`: Ring cannot currently provide usable evidence.

## Responsibility split

The visual model may identify a newly visible movable object, return its bounds or mask, report confidence, and flag occlusion. Deterministic application code stores the resident's protected zone, computes overlap, applies freshness and confidence policy, controls state transitions, deduplicates alerts, and enforces retention.

Localization output is accepted only through a strict schema: supported observable category, normalized in-frame bounds, confidence between zero and one, occlusion flag, and the timestamp of the exact source frame. Invalid model output never reaches geometry and becomes `REVIEW NEEDED`.

The application never infers visitor identity, intent, disability, legal compliance, or whether a person can physically maneuver around an object.

## Evidence policy

1. Start from Ring event metadata.
2. Retrieve visual evidence only when it can change the state.
3. Never carry `ZONE CLEAR` across relevant motion without fresh analyzable evidence.
4. Store derived bounds, confidence, timestamp, and decision—not raw media—unless the resident explicitly preserves it.
5. Treat model uncertainty as `REVIEW NEEDED`; model confidence cannot override deterministic policy.

## Feasibility evidence — October 9, 2026

- The Ring Playground Package scenario created a real WHEP session and returned `201 Created`.
- The video showed a clearly visible parcel in a fixed entrance view.
- After the stream completed, Event History contained a new `on_demand` event spanning the current session.
- The simulator therefore supports a real Ring-driven demo and a metadata-to-live-evidence loop.
- Snapshot and clip retrieval against the Playground device remain unverified; WHEP frame capture is the approved MVP path.
