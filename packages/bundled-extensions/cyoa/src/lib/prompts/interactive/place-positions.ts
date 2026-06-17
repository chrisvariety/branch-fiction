import { createPrompt, PromptMeta } from '@branch-fiction/extension-sdk/llm/prompt';
import * as v from 'valibot';

const InputSchema = v.object({
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      arcs: v.array(
        v.object({
          friendlyId: v.string()
        })
      )
    })
  ),
  placeNames: v.array(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Place Positions',
  input: InputSchema
};

const prompt = `Please provide a detailed text description listing each location by name and their specific position in the image you just generated. For each location (visible through windows arranged on a wall), describe:
- Their position on the wall (using flexible descriptions like "upper left", "center-right", "lower-middle", "top corner", "staggered between center and right", etc.)
- Key visual details and what's visible through the window
- Any notable features or activities
- Which arc ID best matches the visual state you rendered for this location

Format your response as XML:

<window_positions>
<window name="[location name]" id="[location ID]" frame_type="[modifier] frame window" arc_id="[arc ID that best matches the rendered visual]">[Position description], [detailed description of visual details and features visible through the window].</window>
...
</window_positions>

Use the following reference for location IDs and arc IDs:
<locations>
{% for place in places %}
  <location name="{{ place.name }}" id="{{ place.friendlyId }}">
    {% for arc in place.arcs %}
    <arc id="{{ arc.friendlyId }}" name="{{ place.name }}" />
    {% endfor %}
  </location>
{% endfor %}
</locations>

For the id attribute, use the exact location id from the reference above.

For the frame_type attribute, use 1-2 simple modifiers followed by "frame window" or "framed window" that describe the window frame style. This should be simple enough for an image segmentation model to understand. Examples:
- "rock frame window"
- "arched framed window"
- "wood frame window"
- "ornate stone frame window"
- "rustic wood frame window"
- "gothic arched frame window"

For the arc_id attribute, select the arc ID from the reference above that best matches the visual state you rendered for each location.

Example:
<window_positions>
<window name="Throne Room" id="throne_room" frame_type="gothic stone frame window" arc_id="A-TR-1">Upper center portion of the wall, elevated stone chamber with arched windows showing stormy sky, purple and gold banners hanging from stone walls.</window>
<window name="Market Square" id="market_square" frame_type="rustic wood frame window" arc_id="A-MS-2">Lower left area, staggered slightly upward, bustling open area with merchant stalls and cobblestone ground, people moving between vendors.</window>
</window_positions>

Include all locations ({{ placeNames | join(', ') }}).`;

export default createPrompt(meta, prompt);
