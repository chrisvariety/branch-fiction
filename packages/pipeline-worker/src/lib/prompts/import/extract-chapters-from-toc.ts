import * as v from 'valibot';

import { createPrompt, PromptMeta } from '../index';

const InputSchema = v.object({
  titles: v.array(v.string())
});

const meta: PromptMeta<typeof InputSchema> = {
  name: 'Extract Chapters from Table of Contents',
  input: InputSchema
};

const prompt = `You will be given a table of contents from a book. Each entry is prefixed with a sequential number (e.g., "1. Cover", "2. Chapter One"). Your task is to identify the chapter entries and return their numeric indices as ranges.

Here is the table of contents:
<table_of_contents>
{% for title in titles %}
{{ title }}
{% endfor %}
</table_of_contents>

Follow these instructions carefully:

1. Identify chapter entries: Chapters can be formatted in various ways:
    - Numbered chapters: "Chapter 1", "Chapter 2", etc.
    - Numbered chapters with titles: "Chapter 1: The Beginning"
    - Named chapters without numbers: "The First Day", "Sunset on the Mountain", etc.
    - Numbered sections: "1", "2", etc. (will appear as e.g. "4. 1", "5. 2" with the prefix we added)

2. Exclude ONLY the following non-chapter items if they appear:
    - Cover
    - Author's notes
    - Preface
    - Introduction
    - Foreword
    - Prologue
    - Appendices
    - Glossary
    - Index
    - Bibliography
    - Reference pages (e.g., "Map of the Kingdom", "Dramatis Personae", "List of Characters")
    - About the author
    - Copyright
    - Dedication
    - Table of Contents

3. IMPORTANT: Stop extracting chapters once you encounter any of these end-matter sections:
    - Epilogue
    - Acknowledgments
    - Bonus content

    Any chapters or content that appear AFTER these sections should be excluded from the output.

4. IMPORTANT: If the entire table of contents consists only of chapter titles (i.e., none of the excluded items above are present), include ALL entries.

5. You may think through the table of contents before producing your final answer. When you are ready, output your final answer wrapped in <chapters>...</chapters> tags. Inside, emit one or more <chapter> elements, each holding either a single index (e.g. "5") or a contiguous range (e.g. "3-25"). Use multiple <chapter> elements only when non-chapter entries (like a Part divider) interrupt the chapter sequence. If there are no chapter entries, output an empty <chapters></chapters>.

Here are examples of correct outputs:

<example>
Input:
1. Chapter 1: The First Day
2. Chapter 2: The Journey Begins
3. Chapter 3: Homecoming

Output:
<chapters>
  <chapter>1-3</chapter>
</chapters>
</example>

<example>
Input:
1. Morning Light
2. The Hidden Path
3. Voices in the Wind
4. The Last Letter

Output:
<chapters>
  <chapter>1-4</chapter>
</chapters>
</example>

<example>
Input:
1. Cover
2. Prologue
3. Chapter 1: The Awakening
4. Chapter 2: New Horizons
5. Epilogue
6. Chapter 3: Extra Content

Output:
<chapters>
  <chapter>3-4</chapter>
</chapters>
</example>

<example>
Input:
1. Chapter 1: Beginning
2. Chapter 2: Middle
3. Chapter 3: End
4. Acknowledgments
5. Bonus Chapter: The Prequel
6. About the Author

Output:
<chapters>
  <chapter>1-3</chapter>
</chapters>
</example>

<example>
Input:
1. Cover
2. Chapter 1: The Letter
3. Chapter 2: The Road North
4. Map of the Kingdom
5. Chapter 3: At the Border
6. Chapter 4: The Final Stand
7. Epilogue

Output:
<chapters>
  <chapter>2-3</chapter>
  <chapter>5-6</chapter>
</chapters>
</example>
`;

export default createPrompt(meta, prompt);
