import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  roomStyle: v.string(),
  artStyle: v.nullable(v.string()),
  places: v.array(
    v.object({
      name: v.string(),
      placement: v.string(),
      frame_style: v.string(),
      architectural_details: v.string(),
      arcs: v.array(
        v.object({
          friendlyId: v.string(),
          content: v.string()
        })
      )
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Place Interactive',
  input: InputSchema
};

const prompt = `Create an artistic composition featuring exactly {{ places.length }} windows set into a wall, each window looking out onto a different location. Complete specifications have been provided for each window's placement, frame style, and architectural details. The design should evoke the feeling of standing in one space and looking out into many different worlds.

Follow the Window Specifications:
- Each location below includes detailed specifications: PLACEMENT, FRAME STYLE, and ARCHITECTURAL DETAILS
- Follow these specifications precisely for each of the {{ places.length }} windows
- The placement describes where the window should be positioned (rows, positions, heights, clustering, etc.)
- The frame style describes the shape, material, and character of the window frame
- The architectural details describe sills, shutters, trim, and decorative elements

Wall and Window Design:
- The wall should feel like a real architectural element (stone, aged plaster, wood, or fantasy material)
- Render each window frame according to its specified FRAME STYLE
- Include each window's specified ARCHITECTURAL DETAILS
- The varied window designs should create a collected, organic feel—as if each window was added at a different time
- Each window reveals a view of a different location beyond

View Through Each Window:
- Through each window, show a detailed, illustrated view of the specific location
- The view should feel like you're looking OUT from inside a room into that location
- {% if artStyle %}Render in {{ artStyle }}{% else %}Render in a polished, semi-realistic illustration style{% endif %}
- Identify and emphasize each location's UNIQUE visual characteristics from its arc descriptions:
  * Distinctive colors (azure glows, green roofs, orange infernos, etc.)
  * Unique atmospheric conditions (humid haze, mage lights, flames, wards, smoke, etc.)
  * Characteristic architectural details (clock towers, carved arches, crenelations, banners, etc.)
  * Signature textures and materials (charred wood, granite, ash, vitrified ground, etc.)
  * For locations with multiple arcs: choose the most complete or established state that represents the location's enduring character (e.g., if the arcs describe a location being destroyed then rebuilt, show the rebuilt state rather than the ruins)
- Each window should have a distinctly different color palette, lighting, and mood based on its location's arc content
- Avoid making all locations look similar - lean into what makes each one visually unique
- The transition from window frame to the view beyond should feel natural

Wall & Interior Space:
- The wall material, texture, and color must match the room style specified below - this ties the composition to the world of the locations
- The wall should feel grounded and architectural, not abstract
- Leave ~10% space at the top for ceiling elements (beams, chandeliers, hanging objects as specified in room style) and ~20-25% at the bottom for interior room elements
- All windows must be positioned in the 10-75% vertical range - no windows at the very top or bottom
- Use lighting to show that light is coming IN through the windows from the different locations
- The overall atmosphere should suggest standing in one unified space looking out at many worlds

Room Style (wall and interior):
{{ roomStyle }}

Overall Requirements:
- The composition should emphasize the contrast between the unified interior space (the wall) and the diverse exterior views (the locations)
- Each window/location should be visually DISTINCT with its own color palette, lighting, and atmosphere drawn from its arc descriptions
- The windows should showcase dramatic visual variety - avoid making all locations look similar, even if they are similar in nature or theme
- Create depth and perspective to enhance the "looking out" feeling
- DO NOT include any text, labels, numbers, or written characters anywhere in the image
- The wall should feel substantial and real, grounding the fantastical views

Here are the locations with their complete window specifications:

<locations>
{% for place in places %}
  <location>
    <name>{{ place.name }}</name>
    <placement>{{ place.placement }}</placement>
    <frame_style>{{ place.frame_style }}</frame_style>
    <architectural_details>{{ place.architectural_details }}</architectural_details>
    <arcs>
      {% for arc in place.arcs %}
      <arc id="{{ arc.friendlyId }}" name="{{ place.name }}">{{ arc.content }}</arc>
      {% endfor %}
    </arcs>
  </location>
{% endfor %}
</locations>

Create a stunning composition where all {{ places.length }} of these locations are revealed through {{ places.length }} distinct windows in a wall. Follow the provided specifications for each window's placement, frame style, and architectural details. The result should suggest we're looking out from one space into many different worlds.`;

export default createPrompt(meta, prompt);
