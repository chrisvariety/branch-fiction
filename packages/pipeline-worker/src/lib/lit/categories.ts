export const CATEGORIES = [
  {
    name: 'Characters',
    type: 'CHARACTER',
    allowed_types: ['CHARACTER', 'POV_CHARACTER', 'PROTAGONIST', 'ANTAGONIST'],
    description:
      'Capture entities that actively participate in the narrative and drive the plot forward through their actions, decisions, or presence. This includes protagonists, antagonists, allies, mentors, and any individual who plays an active role in events. Characters typically have agency, make choices that affect outcomes, or directly influence other characters. Entities that are only mentioned or observed without actively participating in the plot should use MENTIONED_INDIVIDUAL instead. Any entity type (people, dragons, sentient objects, divine beings, etc.) can be a CHARACTER if they actively participate in the story, and can additionally be categorized by their nature (SPECIES, OBJECT, DEITY, etc.).',
    examples: []
  },
  {
    name: 'Mentioned Individuals',
    type: 'MENTIONED_INDIVIDUAL',
    allowed_types: ['MENTIONED_INDIVIDUAL', 'BACKGROUND_CHARACTER', 'REFERENCED_PERSON'],
    description:
      'Capture any person or individual being who is mentioned or described, but whose perspective (e.g., POV, spoken dialogue, internal monologue) is **not** directly shared with the reader. This category is for figures who do _not_ pass the \'Character\' litmus test. For unnamed individuals, use a descriptive phrase like "hazel-eyed red-haired female soldier".',
    examples: [
      {
        example_description:
          "For a mentioned noble described as 'Marcus Voss', who is also referred to as 'the Lord Commander of the Northern Watch':",
        names: ['Marcus Voss', 'the Lord Commander of the Northern Watch'],
        aliases: 'the Lord Commander of the Northern Watch',
        is_named: 'true',
        keywords: 'lord commander, northern watch, military leader, mentioned individual'
      },
      {
        example_description:
          "For an unnamed soldier described as 'the hazel-eyed red-haired female soldier':",
        names: ['hazel-eyed red-haired female soldier'],
        aliases: '',
        is_named: 'false',
        keywords: 'soldier, hazel eyes, red hair, female, unnamed individual'
      }
    ]
  },
  {
    name: 'Places',
    type: 'PLACE',
    allowed_types: ['PLACE', 'LOCATION', 'BUILDING', 'REGION', 'LANDMARK'],
    description:
      "Include countries, cities, specific buildings, and unique, named structures or locations (e.g., *The Dragon's Roost*, *The Crystal Spires*). Include any location that is treated as a proper noun in the text, even if the name is also a common noun (e.g., *The Forest*, *The River*). Sentient locations that communicate their perspective should also be tagged as CHARACTER. Locations that serve as cultural rituals or trials should also be tagged as CULTURAL_ELEMENT or CONCEPT_RITUAL.",
    examples: [
      {
        example_description:
          "For a mystical tavern described as 'The Dragon's Roost, perched on the cliffs overlooking the sea', later simply called 'The Roost':",
        names: ["The Dragon's Roost"],
        aliases: 'The Roost',
        is_named: 'true',
        keywords: 'tavern, cliff-side, overlooks sea, mystical location'
      },
      {
        example_description:
          "For a kingdom usually called 'Valdris', but formally known as 'the Northern Kingdom of Valdris', and sometimes referred to as 'the Northern Realm' or 'Land of Eternal Winter':",
        names: ['Valdris', 'the Northern Realm', 'Land of Eternal Winter'],
        aliases: 'the Northern Realm, Land of Eternal Winter',
        is_named: 'true',
        keywords: 'kingdom, northern realm, eternal winter, cold climate'
      },
      {
        example_description:
          "For a location referred to as 'the dead marshes, treacherous swampland where travelers go missing', also called 'the sunken lands':",
        names: ['the dead marshes', 'the sunken lands'],
        aliases: 'the sunken lands',
        is_named: 'true',
        keywords: 'marshland, swamp, treacherous terrain, dangerous location'
      }
    ]
  },
  {
    name: 'Deities or Divine Figures',
    type: 'DEITY',
    allowed_types: ['DEITY', 'GOD', 'GODDESS', 'DIVINE_FIGURE', 'DEMIGOD'],
    description:
      'Capture any being that is worshipped, has a defined divine portfolio, or is explicitly referred to as a god, goddess, demigod, or similar divine entity (e.g., *Zephyra, the Goddess of Winds*; *The Sunken God*). Divine figures whose perspective is directly shared with the reader (through dialogue or POV) should also be tagged as CHARACTER.',
    examples: [
      {
        example_description:
          "For a goddess most often called 'Zephyra', but whose full title is 'Zephyra, the Goddess of Winds', and worshippers call her 'Wind Mother':",
        names: ['Zephyra, the Goddess of Winds', 'Wind Mother'],
        aliases: 'Wind Mother',
        is_named: 'true',
        keywords: 'goddess, winds, sailing, divine guidance, worshipped deity'
      },
      {
        example_description:
          "For an ancient entity called 'The Sunken God, slumbering beneath the waves', also known as 'The Slumbering One' and 'Deep Dreamer':",
        names: ['The Sunken God', 'The Slumbering One', 'Deep Dreamer'],
        aliases: 'The Slumbering One, Deep Dreamer',
        is_named: 'true',
        keywords: 'ancient god, underwater, sleeping, mysterious deity, oceanic power'
      }
    ]
  },
  {
    name: 'Organizations',
    type: 'ORGANIZATION',
    allowed_types: ['ORGANIZATION', 'GROUP', 'FACTION', 'GUILD', 'ORDER', 'HOUSE'],
    description:
      "Extract formal and informal groups that act as collective entities within the world. This includes guilds, military orders, noble houses, clans, religious orders, secret societies, governing bodies, and any other structured groups with shared purpose or identity (e.g., *The Mages' Guild*, *House Ravencrest*, *The Order of the Silent Blade*, *The Council of Elders*). If an entity functions as both the organization and its physical headquarters (e.g., 'The Mages' Guild' used for both the group of mages and the building they meet in), tag it with both ORGANIZATION and PLACE. If the text uses distinct names for each (e.g., 'The Mages' Guild' organization meets at 'The Guild Tower' building), extract them as separate entities.",
    examples: [
      {
        example_description:
          'For a magical guild formally named "The Mages\' Guild of Silverwood", but usually just called "The Mages\' Guild", and sometimes referred to as "The Guild" or "Arcane Brotherhood":',
        names: ["The Mages' Guild", 'Arcane Brotherhood'],
        aliases: 'The Guild, Arcane Brotherhood',
        is_named: 'true',
        keywords:
          'magical organization, arcane knowledge, guild structure, protective order'
      },
      {
        example_description:
          'For a noble house mentioned as "House Ravencrest, ancient bloodline of the eastern kingdoms", also called "The Ravencrests" and "Eastern Lords":',
        names: ['House Ravencrest', 'Eastern Lords'],
        aliases: 'The Ravencrests, Eastern Lords',
        is_named: 'true',
        keywords: 'noble house, ancient bloodline, eastern kingdoms, aristocratic family'
      }
    ]
  },
  {
    name: 'Species and Creatures',
    type: 'SPECIES',
    allowed_types: ['SPECIES', 'CREATURE', 'SPECIES/CREATURE', 'CREATURE/SPECIES'],
    description:
      'Extract any fantasy-specific sentient races, monsters, or significant beings (e.g., *Orcs*, *Elves*, *Dragons*, *Golems*, *Griffins*). This category is for the species/creature type itself. Individual named members with unique perspectives should be extracted as separate entities and tagged as CHARACTER (and optionally SPECIES if their species identity is significant to their role).',
    examples: [
      {
        example_description:
          "For a fantasy race described as 'the shadow elves, dwellers of the twilight forests', and sometimes called 'Twilight Dwellers' or 'The Shadowed':",
        names: ['the shadow elves', 'Twilight Dwellers', 'The Shadowed'],
        aliases: 'Twilight Dwellers, The Shadowed',
        is_named: 'true',
        keywords: 'elven subspecies, twilight forests, shadow magic, fantasy race'
      },
      {
        example_description:
          "For creatures commonly known as 'dire wolves', but classified by scholars as 'Great Northern Canids', and also called 'Northern Predators' or 'Great Wolves':",
        names: [
          'dire wolves',
          'Great Northern Canids',
          'Northern Predators',
          'Great Wolves'
        ],
        aliases: 'Northern Predators, Great Wolves',
        is_named: 'true',
        keywords: 'oversized wolves, northern wastes, apex predators, dangerous creatures'
      }
    ]
  },
  {
    name: 'Significant Objects',
    type: 'OBJECT',
    allowed_types: ['OBJECT', 'ARTIFACT', 'ITEM', 'WEAPON', 'TOOL', 'RELIC'],
    description:
      "Extract any significant objects, whether they have a proper name (e.g., *Excalibur*) or are identified by a unique description (e.g., 'the armored breastplate', 'the silver locket'). Consider an object significant if it is specially made for a character, described in detail, or pivotal to the plot. This category is for crafted or unique items. Sentient objects that communicate their perspective should also be tagged as CHARACTER. Raw materials or substances (e.g., 'mithril', 'dragonwood') should be extracted as separate entities and tagged as FLORA_FAUNA_MATERIAL.",
    examples: [
      {
        example_description:
          "For a legendary sword most people call 'Dawnbreaker', which was forged with the full name 'Dawnbreaker, the Blade of the First Light', and referred to in legends as 'The Shadow Cutter' and 'Blade of Dawn':",
        names: [
          'Dawnbreaker, the Blade of the First Light',
          'The Shadow Cutter',
          'Blade of Dawn'
        ],
        aliases: 'The Shadow Cutter, Blade of Dawn',
        is_named: 'true',
        keywords: 'legendary sword, cuts shadow, dawn magic, significant weapon'
      },
      {
        example_description:
          "For a mysterious item described as 'the silver locket with intricate runes', later referred to as 'The Runed Locket':",
        names: ['The Runed Locket'],
        aliases: 'The Runed Locket',
        is_named: 'false',
        keywords: 'silver locket, intricate runes, mysterious artifact, personal item'
      }
    ]
  },
  {
    name: 'Magic Systems and Sources',
    type: 'MAGIC_SYSTEM',
    allowed_types: ['MAGIC_SYSTEM', 'MAGIC_SOURCE', 'POWER_SOURCE', 'MAGICAL_FRAMEWORK'],
    description:
      'Identify the fundamental rules, principles, and power sources that govern supernatural abilities. This category is for the underlying framework of magic (e.g., *The Weave*, *Allomancy*, *Channeling the One Power*, *Bloodmagic*) and conduits or power sources that enable the manifestation of magic (e.g., *Ley Lines*, *Mana Crystals*, *The Astral Flow*, *Elemental Nodes*). Sentient magic sources that communicate their perspective should also be tagged as CHARACTER.',
    examples: [
      {
        example_description:
          "For a magic system described as 'The Weave, the underlying fabric of all magic', also referred to as 'Magical Fabric' and 'The Source':",
        names: ['The Weave', 'Magical Fabric', 'The Source'],
        aliases: 'Magical Fabric, The Source',
        is_named: 'true',
        keywords: 'magic system, underlying fabric, source of power, mystical framework'
      },
      {
        example_description:
          "For magical conduits described as 'Ley Lines, rivers of raw magical energy crisscrossing the world', also called 'The Dragon Veins' or 'Arcane Currents':",
        names: ['Ley Lines', 'The Dragon Veins', 'Arcane Currents'],
        aliases: 'The Dragon Veins, Arcane Currents',
        is_named: 'true',
        keywords:
          'magical conduit, energy flow, ley lines, power source, natural magic channels'
      }
    ]
  },
  {
    name: 'Historical Events, Legends, or Prophecies',
    type: 'HISTORICAL_EVENT',
    allowed_types: ['HISTORICAL_EVENT', 'LEGEND', 'PROPHECY', 'MYTH', 'WAR', 'ERA'],
    description:
      "Capture named events from the world's lore that are referenced in the text, including wars, foundational myths, and specific prophecies (e.g., *The Last Great War*, *The Song of Eldara*, *The Prophecy of the Twin Kings*).",
    examples: [
      {
        example_description:
          "For a historical conflict commonly called 'The War of Broken Crowns', but officially recorded as 'The Aethelian Succession Crisis', and sometimes referred to as 'The Crown War' or 'The Great Falling':",
        names: [
          'The War of Broken Crowns',
          'The Aethelian Succession Crisis',
          'The Crown War',
          'The Great Falling'
        ],
        aliases: 'The Crown War, The Great Falling',
        is_named: 'true',
        keywords: 'historical war, succession crisis, political collapse, major conflict'
      },
      {
        example_description:
          "For a prophecy described as 'The Prophecy of the Twin Kings, foretelling the rise of dual rulers', also known as 'The Twin Prophecy' and 'Dual Crown Foretelling':",
        names: [
          'The Prophecy of the Twin Kings',
          'The Twin Prophecy',
          'Dual Crown Foretelling'
        ],
        aliases: 'The Twin Prophecy, Dual Crown Foretelling',
        is_named: 'true',
        keywords: 'prophecy, twin rulers, foretelling, dual kingship, future prediction'
      }
    ]
  },
  {
    name: 'Fictional Languages',
    type: 'LANGUAGE',
    allowed_types: ['LANGUAGE', 'DIALECT', 'TONGUE', 'SPEECH'],
    description:
      'Include any named languages unique to the world (e.g., *Elvish*, *Draconic*, *The Old Tongue*).',
    examples: [
      {
        example_description:
          "For a fantasy language speakers call 'the Old Tongue', whose true name is 'Valarinth', and scholars refer to as 'The First Speech' or 'True Tongue':",
        names: ['the Old Tongue', 'Valarinth', 'The First Speech', 'True Tongue'],
        aliases: 'The First Speech, True Tongue',
        is_named: 'true',
        keywords: 'ancient language, true names, forgotten speech, magical dialect'
      },
      {
        example_description:
          "For a draconic language described as 'Draconic, the primal language of power', also called 'Dragon Speech' and 'The Primal Tongue':",
        names: ['Draconic', 'Dragon Speech', 'The Primal Tongue'],
        aliases: 'Dragon Speech, The Primal Tongue',
        is_named: 'true',
        keywords:
          'dragon language, primal speech, language of power, ancient communication'
      }
    ]
  },
  {
    name: 'Flora, Fauna, and Materials',
    type: 'FLORA_FAUNA_MATERIAL',
    allowed_types: [
      'FLORA',
      'FAUNA',
      'MATERIAL',
      'FLORA_FAUNA_MATERIAL',
      'PLANT',
      'ANIMAL',
      'SUBSTANCE'
    ],
    description:
      "Capture unique plants, animals, and special substances that are part of the world's environment or economy (e.g., *Kingsfoil* (flora), *Shadow-cat* (fauna), *Mithril* (material)). This category is for raw materials, plant/animal species, and natural substances. Sentient flora or fauna that communicate their perspective should also be tagged as CHARACTER. Crafted items made from these materials (e.g., 'a mithril sword named Starfire') should be extracted as separate entities and tagged as OBJECT.",
    examples: [
      {
        example_description:
          "For a magical plant colloquially known as 'Moonblossom', with the formal botanical name 'Argentum Noctiflora', and sometimes called 'Silver Flower' or 'Starlight Bloom':",
        names: ['Moonblossom', 'Argentum Noctiflora', 'Silver Flower', 'Starlight Bloom'],
        aliases: 'Silver Flower, Starlight Bloom',
        is_named: 'true',
        keywords:
          'magical plant, silver flower, glows under starlight, nocturnal bloom, botanical name'
      },
      {
        example_description:
          "For a rare metal mentioned as 'voidsteel, the black metal that absorbs magic', also referred to as 'Black Metal' and 'Magic Absorber':",
        names: ['voidsteel', 'Black Metal', 'Magic Absorber'],
        aliases: 'Black Metal, Magic Absorber',
        is_named: 'true',
        keywords: 'rare metal, black color, absorbs magic, anti-magical material'
      }
    ]
  },
  {
    name: 'Laws, Oaths, and Codes',
    type: 'LAW_OATH_CODE',
    allowed_types: ['LAW', 'OATH', 'CODE', 'LAW_OATH_CODE', 'COVENANT', 'VOW'],
    description:
      "Extract named laws, binding oaths, or formal codes of conduct that govern individuals or groups (e.g., *The Mage's Covenant*, *The Code of the Kingsguard*, *The First Law of Iron*).",
    examples: [
      {
        example_description:
          "For a magical law described as 'The First Law of Magic: never use power to harm the innocent', also known as 'The Prime Law' and 'Magic's First Rule':",
        names: ['The First Law of Magic', 'The Prime Law', "Magic's First Rule"],
        aliases: "The Prime Law, Magic's First Rule",
        is_named: 'true',
        keywords: 'magical law, protect innocent, fundamental rule, ethical code'
      },
      {
        example_description:
          "For a knightly oath commonly referred to as 'The Code of the Silver Shield', which is formally Article III of 'The Paladin's Covenant', and sometimes called 'The Shield Code' or 'Silver Vows':",
        names: [
          'The Code of the Silver Shield',
          "Article III of The Paladin's Covenant",
          'The Shield Code',
          'Silver Vows'
        ],
        aliases: 'The Shield Code, Silver Vows',
        is_named: 'true',
        keywords:
          'knightly code, binding vows, protection oath, chivalric law, formal article'
      }
    ]
  },
  {
    name: 'Titles and Ranks',
    type: 'TITLE_RANK',
    allowed_types: ['TITLE', 'RANK', 'TITLE_RANK', 'POSITION', 'OFFICE'],
    description:
      'Identify named titles or ranks when they are discussed as an abstract concept, not when attached to a specific person (e.g., "The rank of *Loremaster* is hard to achieve.").',
    examples: [
      {
        example_description:
          "For a rank discussed as 'The rank of Loremaster is hard to achieve in the academy', formally titled 'Master of Lore':",
        names: ['Master of Lore'],
        aliases: 'Master of Lore',
        is_named: 'true',
        keywords:
          'academic rank, difficult achievement, scholarly title, knowledge mastery'
      },
      {
        example_description:
          "For a high military rank often shortened to 'Lord Commander', but whose full title is 'Lord Commander of the Royal Griffon Guard', and sometimes simply called 'Commander of the Guard':",
        names: ['Lord Commander', 'Lord Commander of the Royal Griffon Guard'],
        aliases: 'Commander of the Guard',
        is_named: 'true',
        keywords: 'military rank, high command, royal guard, leadership title'
      }
    ]
  },
  {
    name: 'Cultural Elements',
    type: 'CULTURAL_ELEMENT',
    allowed_types: [
      'CULTURAL_ELEMENT',
      'RELIGION',
      'HOLIDAY',
      'CUSTOM',
      'TRADITION',
      'FESTIVAL'
    ],
    description:
      'Include named religions, holidays, customs, traditions, and cultural practices unique to the world (e.g., *The Path of Flame* (religion), *The Day of Ascension* (holiday), *the rite of silent mourning* (custom)).',
    examples: [
      {
        example_description:
          "For a religion described as 'The Path of Flame, worship of the eternal fire', and followers call it 'Fire Faith' or 'The Eternal Way':",
        names: ['The Path of Flame', 'Fire Faith', 'The Eternal Way'],
        aliases: 'Fire Faith, The Eternal Way',
        is_named: 'true',
        keywords: 'religion, eternal fire worship, spiritual path, flame deity'
      },
      {
        example_description:
          "For a holiday popularly known as 'The Festival of Stars', which is formally named 'The Annual Celebration of the Celestial Convergence', and sometimes called 'Star Festival' or 'Twin Moon Night':",
        names: [
          'The Festival of Stars',
          'The Annual Celebration of the Celestial Convergence',
          'Twin Moon Night'
        ],
        aliases: 'Star Festival, Twin Moon Night',
        is_named: 'true',
        keywords:
          'holiday, twin moons, celestial alignment, cultural celebration, annual event'
      }
    ]
  },
  {
    name: 'World-Specific Concepts and Rituals',
    type: 'CONCEPT_RITUAL',
    allowed_types: [
      'CONCEPT',
      'RITUAL',
      'CONCEPT_RITUAL',
      'CEREMONY',
      'PHENOMENON',
      'RITE'
    ],
    description:
      'Identify named rituals, ceremonies, unique phenomena, or abstract ideas that are not broad systems. These are often specific applications of magic or key cultural events (e.g., *The Choosing Ceremony*, *The Harrowing*, *The Convergence*).',
    examples: [
      {
        example_description:
          "For a rite of passage typically called 'The Harrowing', but known in sacred scrolls as 'The Ritual of Soul-Forging', and elders refer to it as 'The Great Trial' or 'Soul Test':",
        names: [
          'The Harrowing',
          'The Ritual of Soul-Forging',
          'The Great Trial',
          'Soul Test'
        ],
        aliases: 'The Great Trial, Soul Test',
        is_named: 'true',
        keywords:
          'rite of passage, magical trial, soul-forging, sacred ritual, dangerous test'
      },
      {
        example_description:
          "For a phenomenon mentioned as 'The Convergence, when magical energies align across realms', also known as 'Energy Alignment' and 'The Great Joining':",
        names: ['The Convergence', 'Energy Alignment', 'The Great Joining'],
        aliases: 'Energy Alignment, The Great Joining',
        is_named: 'true',
        keywords:
          'magical phenomenon, energy alignment, cross-realm event, mystical occurrence'
      }
    ]
  }
] as const;
