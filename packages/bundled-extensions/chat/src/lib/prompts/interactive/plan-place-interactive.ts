import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  type: v.picklist(['HORIZONTAL', 'VERTICAL']),
  places: v.array(
    v.object({
      friendlyId: v.string(),
      name: v.string(),
      arcs: v.array(
        v.object({
          content: v.string()
        })
      )
    })
  )
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Plan Place Interactive',
  input: InputSchema
};

const prompt = `You will be planning the layout of windows in an artistic wall composition. Each window will look out onto a different location. Your task is to determine where each window should be positioned on the wall based on the number of locations and the orientation type.

{% if type == 'HORIZONTAL' %}
The composition will be HORIZONTAL orientation with a 16:9 aspect ratio (wide and not very tall). This means you can fit more windows per row - typically 4-5 windows in a single row. Leave space at both the top (~10%) and bottom (~20-25%) of the composition - windows should occupy roughly the 10-75% vertical range.
{% else %}
The composition will be VERTICAL orientation with a 9:16 aspect ratio (tall and narrow). This means fewer windows per row - typically maximum 3 windows in a single row, often just 2. Leave space at both the top (~10%) and bottom (~20-25%) of the composition - windows should occupy roughly the 10-75% vertical range.
{% endif %}

Here are the locations that need windows, along with their narrative arcs. The locations are ordered by importance - the first location is the most important, and importance decreases down the list.

<locations>
{% for place in places %}
  <location index="{{ loop.index }}" id="{{ place.friendlyId }}" name="{{ place.name }}">
    <arcs>
      {% for arc in place.arcs %}
      <arc>{{ arc.content }}</arc>
      {% endfor %}
    </arcs>
  </location>
{% endfor %}
</locations>

Your task is to plan out where each window should be positioned on the wall, taking the location ordering/importance into account. Before providing your final layout, use a scratchpad to think through your approach.

In your scratchpad, you should:
1. Count the total number of locations
2. Note the orientation type and what that means for row capacity
3. Sketch out a rough arrangement strategy
4. Consider visual balance and how to make the composition interesting

{% if places.length == 7 or places.length == 8 or places.length == 10 %}
For this constellation-like pattern:
- Arrange windows in an asymmetric, organic pattern rather than rigid rows
- Use varied heights and clustering within the upper portion of the wall
- Create visual interest through irregular spacing
- Still respect the aspect ratio constraints (horizontal allows wider spread, vertical requires more vertical stacking)
{% else %}
For this row-based pattern:
- Arrange windows in rows within the upper portion of the wall
{% if type == 'HORIZONTAL' %}
- Use 4-5 windows per row typically
{% else %}
- Use 2-3 windows per row typically (often just 2)
{% endif %}
- Consider slight variations in vertical positioning within rows for visual interest
{% endif %}

For your final output, provide detailed specifications for each window including:

1. PLACEMENT: Where the window is positioned on the wall
   - Which row it's in or general vertical position
   - Position within that row or horizontal position (locations with lower indices, being more important, should be more central)
   - Notable positioning details like "slightly higher", "lower and to the left"
   - Relative size (small, medium, large, or specific proportions - locations with lower indices should generally be larger)

2. FRAME STYLE: The design and character of a single window frame
   - Overall shape: arched, rectangular, rounded, gothic pointed arch, irregular, etc.
   - Frame material and construction: ornate carved wood, simple stone, weathered timber, metal, etc.
   - Internal division: multi-paned (divided by muntins), single large pane, leaded glass, etc.
   - Draw from the location's arcs to inform the frame character (e.g., a grand palace might have an ornate gilded frame, a burned city might have a charred wooden frame, a mystical grove might have a living wood frame with vines)

3. ARCHITECTURAL DETAILS: Specific features for visual variety
   - Window sill type: stone ledge, wooden sill, decorative corbels, none, etc.
   - Shutters: wooden shutters, metal grilles, fabric curtains, none, etc.
   - Decorative elements: trim, stonework, carvings, fixtures, climbing vines, etc.
   - Let the location's narrative arcs inspire these details (e.g., a military fortress might have iron grilles, a magical academy might have glowing runes on the sill)

CRITICAL: Ensure dramatic variety across all windows. No two windows should have the same frame style or architectural treatment. Each window should feel unique and tell its own visual story. Use the narrative arcs to inspire frame designs that echo each location's character and history.

Before providing your final answer, use a scratchpad to work through your planning:
- Count the total number of locations
- Note the orientation type and what that means for row capacity
- Review each location's narrative arcs to understand its character, history, and visual qualities
- Consider the location ordering - plan to place locations with lower indices (more important) more centrally and make them larger
- Sketch out a rough arrangement strategy considering placement hierarchy, size variation, and frame variety
- Deliberately plan contrasting frame styles that draw from each location's arcs
- Consider how each frame style can echo the location's narrative (materials, condition, ornamentation, etc.)
- Plan the room style - analyze all locations' arcs to identify unifying themes (coastal/maritime, magical, industrial, medieval, etc.) and design a cohesive room aesthetic including wall material/texture, color palette, ceiling elements (beams, chandeliers, hanging objects), and interior furnishings that ground the viewer in a space that belongs to this world

Make sure every location has a corresponding entry with complete placement and frame specifications.

Your output should be in XML format with the following structure:

<place_plan>
  <room_style>comprehensive description of the room we're standing in, derived from the locations' themes. Include: (1) wall material, texture, and condition (e.g., weathered gray stone, salt-pitted plaster, warm sandstone, industrial metal panels); (2) color palette for the wall; (3) thematic accents on the wall (lichen, frost patterns, carved runes, riveted seams, etc.); (4) ceiling/upper wall elements visible at the top - exposed wooden beams, hanging lanterns, chandeliers, crown molding, banners, dried herbs, ship's rigging, floating candles, industrial pipes, etc. (avoid arches); (5) the interior space visible at the bottom - floor type, furnishings, lighting fixtures (sconces, lanterns, candles), and objects that belong to this world</room_style>
  <placements>
    <placement location_id="exact id of the location">
      <placement_description>detailed description of where this window should be positioned on the wall</placement_description>
      <frame_style>description of the window frame shape, material, and overall character</frame_style>
      <architectural_details>description of sills, shutters, trim, and other decorative elements</architectural_details>
    </placement>
  </placements>
</place_plan>
`;

export default createPrompt(meta, prompt);
