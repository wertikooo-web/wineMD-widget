# WINE AI — Stage 1 changes

Implemented in this archive:

- new WINE AI landing page at `/demo.html`;
- automatic language detection in the voice widget;
- removed manual RU/RO/EN buttons from the customer widget;
- the widget now uses `general_chat` mode: it searches the wine knowledge base first and falls back to a general AI answer when no relevant evidence is found;
- the server keeps `knowledge_only` as the safe default for API clients that do not explicitly request `general_chat`;
- prepared `answerMode` API field for the future admin-panel switch.

Run:

```bash
npm install
npm start
```

Open:

- site: `http://localhost:3000/demo.html`
- admin: `http://localhost:3000/admin`

Validation: `npm test` — 62 tests passed.
