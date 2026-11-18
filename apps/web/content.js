// Lesson content, one entry per language. app.js renders every clip from this data.
//
// Clip kinds:
//   vocab  term + syllables (hit = stressed index) + meaning
//   quiz   fill-the-blank, one right option
//   speak  a line to say back, scored with speech recognition
//   flip   a card with front / reading / meaning / memory note
// Duels are generated from each language's `duel` pairs: [prompt, answer].

const CREATORS = {
  maria:  { handle: "maria.habla",  a: "#ff9a7a", b: "#e8473b", initial: "M" },
  diego:  { handle: "diego.dice",   a: "#ffb199", b: "#d9533d", initial: "D" },
  louis:  { handle: "louis.fr",     a: "#7d93ff", b: "#3646d6", initial: "L" },
  camille:{ handle: "camille.parle",a: "#a9b7ff", b: "#5470ff", initial: "C" },
  yuki:   { handle: "yuki.jp",      a: "#5470ff", b: "#8a4dff", initial: "Y" },
  priya:  { handle: "priya.learns", a: "#7d93ff", b: "#3646d6", initial: "P" },
};

const LANGS = {
  es: {
    name: "Spanish", flag: "🇲🇽", speech: "es-MX",
    clips: [
      { id: "es-v1", kind: "vocab", tag: "Slang", term: "¿Qué onda?", phon: ["keh", "ON", "dah"], hit: 1, meaning: "what's up?",
        caption: "literally \"what wave?\" but it just means what's up. say it to anyone under 40 in Mexico City 🌊", creator: "maria" },
      { id: "es-q1", kind: "quiz", tag: "Quick fire", q: "Yo ___ estudiante.", sub: "I am a student.", options: ["estoy", "soy", "tengo"], answer: "soy",
        explain: "ser (soy) for what you are, estar (estoy) for how you are", caption: "ser vs estar, the eternal struggle 😤", creator: "diego" },
      { id: "es-s1", kind: "speak", tag: "Your turn", line: "Una mesa para dos, por favor.", meaning: "A table for two, please.",
        caption: "walk in, say this, you're seated. easy 🌮", creator: "maria" },
      { id: "es-f1", kind: "flip", tag: "Word of the day", front: "madrugada", reading: "mah-droo-GAH-dah", meaning: "the small hours",
        note: "the time after midnight, before sunrise. English has no single word for it", caption: "for when you're up at 3am doing this 👀", creator: "diego" },
      { id: "es-v2", kind: "vocab", tag: "Food", term: "Está riquísimo", phon: ["rree", "KEE", "see", "moh"], hit: 1, meaning: "it's super tasty",
        caption: "say this to the abuela who cooked and you're family now 🫶", creator: "maria" },
      { id: "es-q2", kind: "quiz", tag: "Quick fire", q: "¿Me ___ la cuenta?", sub: "Can you bring me the check?", options: ["trae", "das", "pones"], answer: "trae",
        explain: "traer = to bring. ¿Me trae la cuenta? is the polite classic", caption: "don't wave your arms, just say this 🧾", creator: "diego" },
    ],
    duel: [["uno", "1"], ["cinco", "5"], ["siete", "7"], ["diez", "10"], ["doce", "12"], ["quince", "15"], ["veinte", "20"], ["treinta", "30"], ["cincuenta", "50"], ["cien", "100"], ["ocho", "8"], ["tres", "3"]],
  },

  fr: {
    name: "French", flag: "🇫🇷", speech: "fr-FR",
    clips: [
      { id: "fr-q1", kind: "quiz", tag: "Quick fire", q: "Le chat est ___ la table.", sub: "The cat is on the table.", options: ["sous", "sur", "dans"], answer: "sur",
        explain: "sous = under, sur = on, dans = in", caption: "everyone gets this one wrong the first time 🐈", creator: "louis" },
      { id: "fr-v1", kind: "vocab", tag: "Everyday", term: "Ça marche", phon: ["sah", "MARSH"], hit: 1, meaning: "sounds good / works for me",
        caption: "literally \"that walks\". use it for literally everything 🚶", creator: "camille" },
      { id: "fr-s1", kind: "speak", tag: "Your turn", line: "Je voudrais un croissant.", meaning: "I would like a croissant.",
        caption: "the boulangerie test. you got this 🥐", creator: "louis" },
      { id: "fr-f1", kind: "flip", tag: "Word of the day", front: "flâner", reading: "flah-NAY", meaning: "to stroll aimlessly",
        note: "wandering a city with no plan, just enjoying it. a whole Parisian art form", caption: "official hobby of Paris 🗼", creator: "camille" },
      { id: "fr-q2", kind: "quiz", tag: "Politeness", q: "___-vous parler plus lentement ?", sub: "Can you speak more slowly?", options: ["Pouvez", "Voulez", "Savez"], answer: "Pouvez",
        explain: "pouvoir = can. you'll need this sentence a lot at first", caption: "the most useful sentence in French tbh 🐌", creator: "louis" },
      { id: "fr-v2", kind: "vocab", tag: "Slang", term: "C'est ouf", phon: ["say", "OOF"], hit: 1, meaning: "that's crazy",
        caption: "ouf = fou backwards. verlan slang, very Paris 🤯", creator: "camille" },
    ],
    duel: [["un", "1"], ["deux", "2"], ["cinq", "5"], ["huit", "8"], ["dix", "10"], ["onze", "11"], ["seize", "16"], ["vingt", "20"], ["trente", "30"], ["soixante", "60"], ["cent", "100"], ["trois", "3"]],
  },


  ja: {
    name: "Japanese", flag: "🇯🇵", speech: "ja-JP",
    clips: [
      { id: "ja-f1", kind: "flip", tag: "Kanji", front: "猫", reading: "neko", meaning: "cat",
        note: "犭 animal + 苗 sprout: a cat napping in the garden", caption: "the little story trick makes kanji stick 🐈‍⬛", creator: "yuki" },
      { id: "ja-v1", kind: "vocab", tag: "Everyday", term: "いただきます", phon: ["i", "ta", "da", "KI", "ma", "su"], hit: 3, meaning: "let's eat (thanks for the food)",
        caption: "said before every meal. hands together optional but cute 🍙", creator: "yuki" },
      { id: "ja-q1", kind: "quiz", tag: "Particles", q: "私 ___ 学生です。", sub: "I am a student.", options: ["は", "を", "に"], answer: "は",
        explain: "は (wa) marks the topic: as for me, student", caption: "は is written ha but said wa. yes really 🙃", creator: "yuki" },
      { id: "ja-s1", kind: "speak", tag: "Your turn", line: "すみません", meaning: "Excuse me / sorry", hint: "su-mi-ma-sen",
        caption: "gets a waiter, apologises, thanks someone. one word does it all 🙇", creator: "yuki" },
      { id: "ja-f2", kind: "flip", tag: "Kanji", front: "雨", reading: "ame", meaning: "rain",
        note: "a window with raindrops running down it", caption: "look at it. it's literally rain on glass ☔", creator: "yuki" },
      { id: "ja-q2", kind: "quiz", tag: "Quick fire", q: "これは ___ ですか。", sub: "How much is this?", options: ["いくら", "どこ", "だれ"], answer: "いくら",
        explain: "いくら (ikura) = how much. どこ = where, だれ = who", caption: "essential for konbini runs 🏪", creator: "yuki" },
    ],
    duel: [["いち", "1"], ["に", "2"], ["さん", "3"], ["よん", "4"], ["ご", "5"], ["ろく", "6"], ["なな", "7"], ["はち", "8"], ["きゅう", "9"], ["じゅう", "10"], ["ひゃく", "100"], ["にじゅう", "20"]],
  },


};

const THEMES = ["red", "blue", "coral", "peach", "ink", "violet"];
const KIND_THEME = { vocab: "red", quiz: "blue", speak: "coral", flip: "peach", duel: "ink", review: "violet" };
const KIND_GLYPH = { vocab: "¿?", quiz: "?", speak: "🎙", flip: "✦", duel: "⚡", review: "🧠" };
