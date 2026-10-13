# ClearPath — Ring hackathon application draft

*Working draft for a general application form. The sections below can be shortened or rearranged once the actual prompts and word limits are known.*

## Project summary

A package at a front door is usually a delivery. If it lands in the part of the entrance a resident needs to use, it can also become a barrier. ClearPath lets a resident mark that part of the camera view and asks a more useful question than “Was there motion?”: **Does a visible parcel or other movable object overlap my route right now?**

ClearPath is a prototype for interpreting a fresh entrance image, not a system that certifies whether an entrance is accessible or safe. It reports four states: **ZONE CLEAR**, **OBSTRUCTION DETECTED**, **REVIEW NEEDED**, and **CAMERA UNAVAILABLE**. When the image is old, unclear, or partly blocked, the answer is review needed rather than an unsupported clear result.

## Problem and audience

The primary audience is residents who want to keep a particular entrance route free of movable obstacles, including people who rely on a clear path for mobility equipment. A generic motion event says that something changed near a door; it does not say whether an object sits in *that resident’s* route. The route also varies by entrance, so ClearPath lets the resident draw the zone instead of assuming that every doorstep has the same usable path.

The intended value is a timely, explainable view of visible overlap that helps a resident decide whether to check the entrance or ask for help. ClearPath does not infer anyone’s disability, a visitor’s identity or intent, or whether someone can physically maneuver around an object.

## How ClearPath works

The resident draws a blue access zone over an entrance view. For a manually captured Ring frame, the app can send one JPEG to a visual model for a structured result: whether a parcel or movable object is visible, one normalized bounding box if found, confidence, and whether the protected area is occluded. ClearPath validates that result, then application code computes how much of the detected object overlaps the resident’s zone. Confidence, visibility, and the age of the frame determine whether the result can support a clear or obstructed assessment. A newly captured frame or a changed Ring zone invalidates the previous assessment.

The Ring token and stream session URL remain on the server. The captured image is transient in the browser and analysis request; ClearPath does not save raw frames. A frame sent for model analysis is subject to the model provider’s data-handling terms.

## What is implemented today

**Synthetic demo, no Ring device or model key required.** The app opens in Sample test mode with a drawn entrance and a supplied parcel box. A resident can move the blue zone and try Clear route, Obstructed, Low confidence, No camera, and Removed presets. The parcel boundary is test data supplied by the app; it is **not AI detection**. This mode exercises the interface, normalized coordinates, overlap calculation, and decision states. The Removed preset simulates a fresh view without the parcel; it does not verify a real removal.

**Manual Ring-frame assessment.** With Ring credentials, the app discovers a device and starts a browser WebRTC stream through Ring’s WHEP API. The user draws a separate Ring zone, captures a frame, and clicks **Analyze captured frame**. With a configured model key, the server requests localization, validates the returned coordinates, and the app calculates the state. Without that key, streaming and clearly labeled debug tools remain available, but they do not turn the live assessment into an AI result. This is a user-initiated, single-frame workflow. It has not been validated end to end on physical Ring hardware in the evidence available for this draft.

The repository also retains a webhook event dashboard from the Ring sample. Those events are displayed separately; they do not currently trigger ClearPath assessment.

## What we tested without Ring hardware

The synthetic scenarios let us test how moving a resident-defined zone changes the result for the *same supplied parcel*, including clear, obstructed, low-confidence, unavailable-camera, and simulated-removal states. Automated tests cover decision geometry and freshness, separation of sample and Ring zones, and the Ring stream endpoint’s handling of tokens and session IDs. The latest recorded local run passed 11 tests, and TypeScript checking passed. These tests do **not** establish real-world detection accuracy.

A separate Ring Developer Playground feasibility check on October 9, 2026, opened a WHEP session (`201 Created`), showed a visible parcel in a fixed entrance view, and produced a corresponding `on_demand` Event History entry. That is simulator evidence for a Ring stream and metadata loop, not evidence that ClearPath automatically analyzed an event or verified parcel removal. Snapshot and clip retrieval were not verified; the current manual flow captures from WHEP video.

## Planned next steps

The next milestone is to use relevant Ring events to request fresh evidence, invalidate an earlier clear assessment when the scene changes, and reassess without a manual capture click. A later version would compare fresh observations to verify removal, deduplicate obstruction notifications, save each resident’s zone, and define a retention policy for derived assessment data. Those capabilities are **planned**, not working features. Evaluation with varied entrances, lighting, placements, and willing residents is also needed before making reliability or impact claims.

## Questions for the applicant

1. What are the hackathon’s exact application prompts, category, character limits, and required submission links? This draft is structured for a general form.
2. Who is submitting (name, team, roles), and what personal or community motivation may be shared? No resident story or quote has been assumed.
3. What demo, repository, or video links should be included, and can the October 9 Playground session be shown as evidence?
4. Has the manual Ring-frame **model analysis** been run successfully with Playground credentials and a model key since the documented feasibility check? If so, provide the result and date so the testing claim can be updated accurately.
5. Is there any user feedback or measured result that may be cited? Until then, the application should make no claims about detection accuracy, time saved, or accessibility outcomes.
