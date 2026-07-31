# FPL Draft Assistant

A draft-day companion for the official Fantasy Premier League Draft game
(draft.premierleague.com), built for a 10-team league. It gives you a ranked
player board, a live pick tracker, best-available suggestions, and Nova, an AI
strategist you can chat with during the draft.

## What it does

- **Draft board**: every player ranked by value over replacement (VORP), with
  projected points, last season's totals, injury news and the opening six
  fixtures. Filter by position, search by name or club. Tap any player to see
  why they are ranked where they are.
- **Fixtures**: all 20 clubs against gameweeks 1 to 6, colour-coded by
  difficulty and sortable by the kindest opening run, which is how you spot the
  defences worth taking in the middle rounds.
- **Live sync**: connect your league ID and the board updates automatically as
  picks are made in your official draft. Manual "Mine"/"Gone" buttons work as a
  backup if you prefer.
- **Best available**: the top remaining players in each position, with your
  squad slots (2 GKP, 5 DEF, 5 MID, 3 FWD) tracked against limits, and each
  card showing its opening-fixture difficulty.
- **My team**: your roster as it builds, saved in your browser between visits.
- **Nova (AI assistant)**: chat about who to pick next. She sees your roster,
  the best available players, and recent picks by rivals, and she can search the
  web for transfer, injury and pre-season news, with her sources listed under
  each answer.

## Deploy on Railway (about 10 minutes)

1. **Put the code on GitHub.** Create a free account at github.com if you do
   not have one. Click the plus icon, "New repository", name it
   `fpl-draft-assistant`, keep it Private, and create it. Then click
   "uploading an existing file" and drag in everything from this folder
   (not the folder itself, its contents). Commit the upload.
2. **Create the Railway project.** In railway.app, choose "New Project", then
   "Deploy from GitHub repo", and pick `fpl-draft-assistant`. Railway detects
   Node, installs, builds the interface, and starts the server on its own.
3. **Add your API key.** In the Railway service, open Variables and add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com (needed for the
     AI chat; everything else works without it)
   - `ANTHROPIC_MODEL` = optional, defaults to `claude-sonnet-4-5`
   - `NOVA_WEB_SEARCH` = optional, defaults to `on`. Set it to `off` to stop
     Nova searching the web. Each search she runs is billed per search on your
     own Anthropic key, on top of the usual message cost, so `off` is the
     cheaper setting if you only want tactical advice. She uses at most three
     searches per answer and only for questions that turn on recent news.
4. **Get your link.** In Settings, under Networking, click "Generate Domain".
   Open that URL on your laptop or phone. That is your app.

Chat usage is pay-as-you-go on your Anthropic key; a busy draft evening of
questions typically costs pennies rather than pounds.

## Using it on draft day

1. Open the **League** tab and enter your league ID. It is the number in the
   web address when you view your league, e.g.
   `draft.premierleague.com/league/12345/status`.
2. Tap your own team name so the app knows which picks are yours.
3. Keep the **Draft board** or **Best available** tab open during the draft.
   Picks sync every 10 seconds. Anything the sync misses you can mark by hand.
4. Ask **Nova** whenever you are on the clock and unsure.

## Notes

- If the FPL API is unreachable, the app shows a small built-in demo dataset
  and a "Demo data" badge so you always see a working interface. On Railway
  you should see the "Live FPL data" badge.
- Your roster and league ID are stored only in your own browser.

## How the rankings work

Every player gets one score, blended from four signals and then turned into
value over replacement for a 10-team draft. Tap a player on the board to see
their own numbers and a one-line explanation.

| Signal | Weight | What it is |
| --- | --- | --- |
| Last season | 45% | Last season's points, adjusted upwards for anyone who missed games but scored well per game |
| FPL draft rank | 35% | FPL's own pre-season draft order, which already prices in transfers, promotions and expected roles |
| Opening fixtures | 10% | Average difficulty of the club's first six gameweeks |
| Availability | 10% | Injury, doubt and suspension flags, plus chance of playing |

Two things worth knowing:

- **New signings and promoted-team players are not buried.** Anyone with under
  900 minutes of Premier League football is scored mostly on the FPL draft rank
  (65%) rather than a thin points record (15%), so a big summer arrival ranks
  where the experts put them.
- **Flagged players are discounted, not hidden.** An injured player still
  appears on the board, just below an otherwise identical fit player.

Fixture difficulty comes from the main FPL game at
fantasy.premierleague.com, cached for six hours. If that feed is unreachable
the board falls back to the two historical signals, says so under the controls,
and the Fixtures tab explains that difficulty is unavailable. Nothing breaks.

To tune the weights, edit `RANKING_WEIGHTS` and `LOW_MINUTES_WEIGHTS` at the top
of `lib/rankings.js`.

## Run locally (optional)

```
npm install
npm run build
npm start
```

Then open http://localhost:3000.

Two checks are available for anyone changing the code:

```
npm test              # unit tests for the ranking model and fixture maths
npm run check:mobile   # screenshots and mobile checks, needs the app running
```

`npm run check:mobile` opens the app at 1280px, 390px, 375px and 360px, saves
screenshots to `screenshots/`, and fails if the page scrolls sideways, a new
control is under 44px, or text drops below 12px.
