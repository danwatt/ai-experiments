# What if I'm half wrong?: script

The source of truth is [narration.json](narration.json). A walk through the [“What if I'm half wrong?”](../half-wrong/) page: Dave Ramsey's retirement math from chapter 9 of *The Total Money Makeover* (12% returns, 4% inflation, spend 8%, a raise every year) and his Joe and Suzy saving example ($625 a month becoming $7,588,545), each checked against real history. Every number comes from the same data and models as that page: `../data.js` (S&P 500 total returns and CPI inflation, December to December) and `../explainer-4/funds.js` (Ramsey's four American Funds, 25% each, from 1981).

One track, no fork. Voiced with Kokoro (Heart) through Voicebox; about 6 minutes.

## 1. The book's promise

> In The Total Money Makeover, Dave Ramsey's retirement plan rests on a few round numbers.

*On screen:* “The Total Money Makeover · Dave Ramsey · first published 2003”, then “A retirement plan built on a few round numbers”

> Make twelve percent a year on average. Inflation takes four. So you can live off eight, and the four left over grows your nest egg and gives you a raise every year.

*On screen:* Twelve tiles, one per percentage point, under “Earn 12% a year”: eight turn blue (“You live off 8%”), four turn gold (“Inflation takes 4%”) · “The 4% left over grows the nest egg 4% a year, and your check with it.” · four claim cards land as each is named: 12% Stocks earn 12% a year · 4% Prices rise 4% a year · 8% You can spend 8% a year · Every year You get a raise

> If you can live on forty thousand dollars a year, you need a nest egg of only five hundred thousand.

*On screen:* “$40,000 a year ÷ 8% = $500,000 nest egg”, each figure counting up

## 2. What if I'm half wrong?

*On screen throughout:* the book's words, each key phrase lighting up as it's read: “If Joe and Suzy invest **$625 per month** … from age thirty to age seventy, they will have **$7,588,545** … **What if I'm half wrong?** What if you end up with only **$4 million?** **What if I'm six times wrong?**” (cuts marked …)

> Then the book does the saving math: Joe and Suzy invest six hundred twenty-five dollars a month, from age thirty to seventy.

*On screen:* A tall meter from $0 to $8M; coins drop in · “$625 a month × 12 months × 40 years = $300,000 put in” (the first $300,000 of the meter in gold)

> The book says they'll have seven million, five hundred eighty-eight thousand dollars.

*On screen:* The meter fills to $7,588,545, the figure counting up beside it · “the book's figure”

> Then it asks: What if I'm half wrong? What if you end up with only four million? What if I'm six times wrong?

*On screen:* Marks slide onto the meter: “Half wrong $4,000,000” · “Six times wrong”

> Even six times wrong is about one point two six million. So let's check each number against history.

*On screen:* “Six times wrong $1,264,758, a sixth” · “Let's check each number against history.”

## 3. Do prices rise 4% a year?

> Start with inflation: every year for the last century, against Ramsey's four percent.

*On screen:* One bar per year 1926–2025 (gold above 4%, blue at or below), a dashed line at “Ramsey's 4%”, a dotted line at “The Total Money Makeover, Sept 2003”

> Over the whole hundred years, prices rose about two point nine percent a year. Before the book, three.

*On screen:* Each span's compounded rate drawn as a level line across its years, with a tile: “The last 100 years, 1926–2025: 2.9%” · “Before the book, 1926–2002: 3.0%”

> But in the thirty years just before it, with the seventies inside, four point nine. So four percent looked right at the time.

*On screen:* 1973–2002 shaded and in focus · “The 30 years before it: 4.9%, 1973–2002, with the '70s inside”

> Since the book, two point six. Four percent holds up, and if anything, it's on the safe side.

*On screen:* 2003–2025 in focus · “Since the book, 2003–2025: 2.6%, 3 of 23 years above 4%” · stamp **HOLDS UP** “a little high, if anything”

## 4. Two ways to average

> Next, twelve percent. There are two ways to average a return, and they aren't the same.

*On screen:* “Simple average: add the returns, divide by the years” · “Compounded: the steady rate the money actually grew at”

> Take ten thousand dollars through four years: up thirty percent, down ten, up twenty-five, up three. That averages twelve percent.

*On screen:* A bar for each year as it's named (+30%, −10%, +25%, +3%) while the balance draws in beside them · “(30 − 10 + 25 + 3) ÷ 4 = 12.0%” with a dashed line at 12%

> But the money ends at fifteen thousand and sixty-four dollars. A steady twelve percent would have made fifteen thousand seven hundred thirty-five.

*On screen:* “$15,064” · a dashed steady-12% line draws to “$15,735”

> The money really grew ten point eight percent a year. Losses hurt more than gains help, and your nest egg grows at the compounded rate, not the average.

*On screen:* “Average 12.0% · Compounded 10.8% · ($15,064 ÷ $10,000) ^ ¼ − 1” · “Lose 10% and you need 11% just to get back.”

## 5. Do stocks earn 12% a year?

> So did stocks make twelve? From 1926 to 2002, the S&P 500 averaged eleven point nine percent, but compounded at ten.

*On screen:* $10,000 in the S&P 500 from the end of 1925, drawing in on a ratio scale · tiles “S&P 500, 1926–2002: simple average 11.9%, compounded 10.0%”

> Over seventy-seven years, that gap is huge: ten thousand dollars became fifteen million, not the fifty-nine million its average suggests.

*On screen:* “$15.2M, what it became” · a dashed line “growing 11.9% every year” draws to “$59.3M”

> Since the book: an average of twelve point seven, compounded eleven point three.

*On screen:* Tiles “S&P 500 since the book, 2003–2025: simple average 12.7%, compounded 11.3%”

## 6. Every 30-year stretch since 1981

> Now every thirty-year stretch since 1981, when the four funds' record starts.

*On screen:* Two rows of 16 squares, S&P 500 and the four funds, one per 30-year stretch (1981–2010 to 1996–2025), each showing its simple average first · “Showing: simple average” · reached 12%: 8 of 16 and 12 of 16

> Compounded, the S&P 500 reached twelve percent in none of sixteen. Ramsey's four funds, in three.

*On screen:* Each square flips over to its compounded rate · “Showing: compounded” · reached 12%: 0 of 16 and 3 of 16 (1981, 1982, 1985) · “1984: 11.99%, a hair short”

> As an average, twelve percent holds. As what your money actually grows at, it's half right.

*On screen:* Stamp **HALF RIGHT** “12% average, about 10–11% compounded”

## 7. Joe and Suzy, for real

> Back to Joe and Suzy: six hundred twenty-five a month for forty years is three hundred thousand dollars put in.

*On screen:* The book's three goals as lines: The book $7,588,545 · Half wrong $4,000,000 · Six times wrong $1,264,758 · “Put in $300,000” (gold at the foot of every bar)

> The funds' record allows only six real forty-year stretches, ending from 2020 to 2025. They ended with three point six to five point nine million.

*On screen:* Three bars for each stretch 1981–2020 to 1986–2025 (Ramsey's four funds, the S&P 500 index, VFINX) · “40 years later: $3.6M–$5.9M”

> None came close to seven point six. Most landed near the book's half wrong, four million.

*On screen:* “0 of 18 reached $7.59M” · “Four funds: $4M+ in 5 of 6”, the $4M line highlighted

> But prices roughly tripled over those forty years. In the money of the year they started, they were worth one point two to two million: closer to six times wrong.

*On screen:* Every bar shrinks to its value in the money of the year saving started · “prices roughly tripled” · “In start-year dollars: $1.2M–$2.0M”, the six-times-wrong line highlighted · stamp **HALF WRONG** “as the book allows”

## 8. Where the $7.6 million comes from

> Part of the gap is the book's own math. A perfectly steady twelve percent makes about six point one million, not seven point six.

*On screen:* Bars: “A steady 12% a year (0.949% a month): $6.12M” against “The book: $7,588,545” · “short by $1.47M”

> The book's figure is closer to one percent a month, which compounds to almost thirteen percent a year.

*On screen:* “1% a month (12.7% a year, compounded): $7.43M”

> What if Joe and Suzy raised their deposit four percent a year, to keep up with inflation? They'd put in seven hundred twelve thousand instead of three hundred.

*On screen:* “Raise the $625 by 4% every year”: the monthly deposit year by year, $625 up to “$2,885 a month by year 40” · “Put in $712,691 instead of $300,000”

> The four funds then hit seven point five nine million in two of six. But after inflation, even the best was about a third of the book's figure.

*On screen:* The four funds' six stretches with raised deposits against a $7.59M line, 1981 ($7.92M) and 1982 ($8.23M) over it in green; then every bar shrinks to start-year dollars ($1.8M–$2.8M) · “after inflation, the best: $2.78M, 37% of the book's figure”

## 9. Can you spend 8% a year?

> Now spending eight percent, in a perfect world: exactly twelve percent every year, exactly four percent inflation.

*On screen:* An empty chart, balance in today's dollars over 55 years, with a dotted “keeping up” line at $500,000 · “12% every year” · “4% inflation”

> The book's math assumes the whole year's twelve percent arrives before you spend a dime. Real retirees spend monthly, like a paycheck.

*On screen:* Twelve months, each paying “−$3,333” in turn · “The book's math: the year's 12% first, then 8% out” · “Real life: a check every month” · “Needed after year 1: $520,000 · Spent monthly: $517,445 · a 3.5% gain, not 4%”

> Forty thousand from five hundred thousand, paid monthly and raised four percent a year, runs out in year thirty-eight.

*On screen:* “Monthly, 8%: $3,333 a month” draws down to “Year 38”

> Taken all on January first, it's gone in year thirty-one.

*On screen:* “All on January 1, 8%” draws down to “Year 31”

> Even seven point six nine percent, dividing out inflation instead of subtracting it, lasts only to year fifty-two.

*On screen:* “Monthly, 7.69% (1.12 ÷ 1.04)”, dashed, draws down to “Year 52”

> The most you can spend monthly and keep up is seven point five two percent. Forty thousand a year needs about five hundred thirty-two thousand.

*On screen:* “Monthly, 7.52%: keeps up”, dotted, flat at $500,000 · “To spend $40,000 a year, monthly, and keep up: $532,000, not $500,000” · stamp **FALLS SHORT** “even with perfect years”

## 10. What actually happened

> Now real history. Five hundred thousand dollars, forty thousand the first year as a monthly check, and a raise each January for actual inflation.

*On screen:* “$500,000 to start” · “$40,000 the first year, monthly” · “a raise each January for actual inflation” · legend: kept up with inflation, lasted but shrank, ran out, still underway (faded)

> Since 1981, of sixteen finished thirty-year retirements in the S&P 500, eleven kept up with inflation, and one ran out.

*On screen:* One cell per 30-year retirement starting 1981–2013, S&P 500 and four funds · “Since 1981: 11 of 16 kept up · 1 ran out” · “Four funds, finished: 16 of 16 kept up · all began 1981–96” · the book's dotted line

> But 1981 came just before the biggest boom on record. Back to 1926, only twenty-nine of seventy-one kept up, and thirty-five ran out.

*On screen:* “1981: just before the biggest boom on record” · the S&P 500 row stretches back to 1926 · “Since 1926: 29 of 71 kept up · 35 ran out” · “1926–31” and “nearly every start, 1956–77” bracketed in red

> Everyone who retired from 2004 to 2008, just after the book, has already run out, in the S&P 500 and the four funds alike. Those who started just after the crash are on track so far.

*On screen:* Back to 1981–2013 · 2004–2008 boxed in red, “2004–08: all ran out” · 2009–2013 boxed in blue, “2009–13: on track so far”

> The plan was the same for all of them. The biggest difference was the year they started.

*On screen:* “The biggest difference: the year you started.” · stamp **DEPENDS ON THE YEAR**

## 11. The scorecard

> So, the scorecard. Four percent inflation holds up. Twelve percent is half right. Seven point six million is half wrong, as the book allows. Spending eight percent falls short.

*On screen:* Five rows, each stamped as it's named: Prices rise 4% a year, **HOLDS UP** (2.9% over 100 years; 2.6% since the book) · Stocks earn 12% a year, **HALF RIGHT** (as an average, yes; compounded, about 10–11%) · $625 a month becomes $7.6 million, **HALF WRONG** ($3.6M–$5.9M; $1.2–2.0M after inflation) · You can spend 8% a year, **FALLS SHORT** (runs out in year 38, even with perfect years) · A raise every year, for life, **DEPENDS ON THE YEAR** (S&P 500 since 1926: 29 of 71 kept up)

> None of this is a reason not to save: Joe and Suzy's real results still beat not saving by a mile.

*On screen:* “Saving $625 a month for 40 years: $300,000 in → $3.6M to $5.9M, in every real 40-year stretch since 1981. Not saving: $0.”

> The plan points the right way. Its numbers are just too tidy. Returns swing, retirees spend every month, and the year you start can matter more than any average.

*On screen:* “The plan points the right way. Its numbers are just too tidy.” · “Returns swing.” · “Retirees spend every month.” · “The start year matters most.” · “Historical simulation, from the same data as the “What if I'm half wrong?” page. Not financial advice.”
