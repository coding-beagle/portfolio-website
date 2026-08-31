# Nicholas Teague's public portfolio website

## Scene previews:

### Snow:
![SNOW](python_scripts/outgifs/snow.gif)

### Rain:
![RAIN](python_scripts/outgifs/rain.gif)

### Plants:
![PLANTS](python_scripts/outgifs/plants.gif)

### Stars:
![STARS](python_scripts/outgifs/stars.gif)

### Boids:
![BOIDS](python_scripts/outgifs/boids.gif)

### Conway:
![CONWAY](python_scripts/outgifs/conway.gif)

### Hexapod:
![HEXAPOD](python_scripts/outgifs/hexapod.gif)

### Mandelbrot:
![MANDELBROT](python_scripts/outgifs/mandelbrot.gif)

### Fire:
![FIRE](python_scripts/outgifs/fire.gif)

### Fireworks:
![FIREWORKS](python_scripts/outgifs/fireworks.gif)

### Plinko:
![PLINKO](python_scripts/outgifs/plinko.gif)

### Gravitalorbs:
![GRAVITALORBS](python_scripts/outgifs/gravitalorbs.gif)

### Liquid:
![LIQUID](python_scripts/outgifs/liquid.gif)

### Life:
![LIFE](python_scripts/outgifs/life.gif)

### Raven:
![RAVEN](python_scripts/outgifs/raven.gif)

### Clocks:
![CLOCKS](python_scripts/outgifs/clocks.gif)

### Pinball:
![PINBALL](python_scripts/outgifs/pinball.gif)

### Ballpit:
![BALLPIT](python_scripts/outgifs/ballpit.gif)

### Pid:
![PID](python_scripts/outgifs/pid.gif)

## Hex tool

A second app built from the same `app/` source tree, for its own subdomain:
paste a hex or binary word and read it back in the other base, column by
column, with Verilog bit selects (`0xDEADBEEF[13]`, `[31:16]`, `[16 +: 16]`).

It shares the site's theming and mobile context by importing them directly.
`REACT_APP_TARGET=hextool` swaps the root component in `src/index.js`, so the
two apps are separate chunks and neither build ships the other's code. The same
page is also reachable from the portfolio at `/#/hextool`.

`make build_hextool` writes `app/build-hextool`, which is what the subdomain's
document root gets.

## Make Commands:

`make install` -> Install JS deps

`make run` -> Run webpack to render website locally

`make run_hextool` -> Run the hex tool locally

`make build` -> Build the portfolio into `app/build`

`make build_hextool` -> Build the hex tool into `app/build-hextool`

`make build_all` -> Build both

`make test` -> Run the unit tests

`make clean` -> Clear out node_modules
