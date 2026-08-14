# FPL Draft Assistant

A companion for the official Fantasy Premier League Draft game
(draft.premierleague.com), built for a 10-team league. Before the draft it gives
you a ranked player board, a live pick tracker and best-available suggestions.
Once the season starts it turns into a weekly assistant: your best legal eleven,
the head-to-head you are playing, and Nova, an AI strategist who knows which
gameweek it is.

## What it does

- **My week**: your best legal eleven from the fifteen, chosen on expected
  points for the gameweeks ahead, with the formation that suits your squad, the
  bench in the order it would come on, and warnings for anyone injured,
  suspended or without a fixture. When your league is connected it also shows
  the manager you are drawn against and a projected scoreline.
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
- **Nova (AI assistant)**: chat about the decision in front of you. Before the
  draft that is who to pick next; once the season is under way she switches to
  weekly management and sees your squad, your opponent, and the players nobody
  owns. She can search the web for injury, line-up and transfer news, with her
  sources listed under each answer.

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

## Using it during the season

1. Open **My week**. It picks your best legal eleven for the next gameweek and
   shows what each player is projected to score, so you can copy it into the
   official site.
2. If your league is connected, the same tab names the manager you are drawn
   against, projects their likely eleven, and gives you the expected margin.
   Their squad is read from the draft, so waiver moves since are not reflected.
3. Check the warnings before you confirm. Anyone injured, suspended or facing a
   blank gameweek is listed by name.
4. Ask **Nova** about a close call. She knows which gameweek is next and who you
   are playing.

## How the weekly projection works

The draft board answers "who is worth a pick". During the season the question is
different, so `lib/season.js` runs a separate model in points per gameweek:

| Signal | Weight | What it is |
| --- | --- | --- |
| Scoring rate | 55% | Points per appearance across the season so far |
| Form | 30% | FPL's own form figure, the last 30 days, ignored until three gameweeks have been played |
| Last season | 15% | A pre-season snapshot, used only while the new season's numbers are still thin |

That rate is then adjusted for the difficulty of the next five gameweeks, for
injury and doubt flags, and for how often the player actually starts. A double
gameweek counts twice and a blank counts for nothing, because the model works in
fixtures rather than gameweeks.

The eleven itself comes from `lib/lineup.js`, which enumerates every legal
formation the squad can fill and picks the highest-scoring one exactly. There is
no captain in this league, so the eleven is the whole weekly decision.

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
npm test              # unit tests for the models, fixture maths and lineup picking
npm run check:mobile   # screenshots and mobile checks, needs the app running
```

`npm run check:mobile` accepts `LEAGUE_ID` and `ENTRY_ID` so the head-to-head
panel is on screen while it checks the weekly view.

`npm run check:mobile` opens the app at 1280px, 390px, 375px and 360px, saves
screenshots to `screenshots/`, and fails if the page scrolls sideways, a new
control is under 44px, or text drops below 12px.
