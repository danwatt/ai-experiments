# Prompts

- **Model:** gpt-6.1-sol
- **Effort:** high
- **Session(s):** 01a1ae1e-ec19-7622-a89f-e09fd80f7368
- **Cost:** unavailable (tokscale failed)

## You

I really enjoyed the game series "Descent" as a kid. Its a 6-degree of freedom, 3d flying/shooter. The maps are constructed out of cubes, of which each side can be deformed, textured, or made to open to another cube.

Can we build something, simpler, a demo, like that in three.js?

Here are some requirements

1. The demo level should be a decent size, taking a few minutes to complete. There should be at least 10 distinct rooms, some of which have doors leading to them
2. There should be a "red key room", that has a floor of lava, that will damage the players ship if touched
3. The reactor should be behind a red key door
4. There should be 3 distinct types of enemies
5. There should be an automap, that will render just the cubes the palyer has traveled into or seen but not yet visited - ie: any cube behind a door will not show up on the map until the door has been opened
6. There should be at least one weapon pickup

Ignore any other prior art in this repository.



Put the code in `games/{name}-gpt-6.1-sol-high`


## Claude

I’ll build a playable Three.js demo with six-axis flight, a multi-room level, combat, key-and-door progression, lava, and an exploration-based automap. I’ll first check the repository instructions, then implement and play-test it.


I’m using the Sites skill for the game’s local preview and browser checks. The demo will be called **Cinder Six**: an industrial mine with a lava chamber, three robot classes, a weapon upgrade, and a reactor escape sequence.


The level layout is in place: fourteen chambers across two elevations, with a vertical shaft and a branching route through the smelter and armory. I’m now connecting flight, combat, doors, and map visibility to the same cube layout so movement and exploration stay consistent.


The first browser checks passed: the red door blocks both access and map visibility, the key opens it, lava damages the ship, the weapon pickup works, and destroying the reactor enables extraction. I’m now checking the visuals, flight controls, and performance.


The visual pass caught oversized ship guns and overlapping corridor signs; both are fixed. I also combined the static metalwork to reduce rendering overhead. The demo now has pause/resume, a flight manual, adjustable mouse sensitivity, sound controls, restart, and an escape countdown.


The gameplay and keyboard-flight checks pass without browser errors. The level contains 408 cubes, 21 enemies, and five doors. I’m checking the lava and reactor views, then finishing the run instructions and test files in the requested folder.


Cinder Six is complete. The included browser checks pass for flight, lava damage, pickups, door locks, map visibility, reactor destruction, and extraction. I also checked the HUD and launch screen at two desktop window sizes. It runs with `npm start`; no build or dependency installation is needed to play.


Built **Cinder Six** in [games/cinder-six-gpt-6.1-sol-high](/Users/danwatt/git/ai-experiments/games/cinder-six-gpt-6.1-sol-high/README.md).

Includes all six requirements:

- 14 rooms across 408 cubes, with doors and vertical passages
- Lava-floor red key room
- Reactor behind a red key door
- Three enemy types
- Exploration automap that respects closed doors
- Collectible plasma weapon

Also includes full six-axis flight, sound, health pickups, and a reactor escape countdown.

Run `npm start` in that folder, then open [localhost:8086](http://127.0.0.1:8086). No installation needed to play.

Browser checks passed with no errors.

## You

Lets call the script to build the prompt.md


## Claude

I’ll find the prompt-generation script and run it for Cinder Six.

