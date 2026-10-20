# XGalaga: Hyperspace — game + shared high-score leaderboard.
#
# The image ships ONLY the deployed artifacts (leaderboard.py + the game
# page/bundle), not the source tree, so a public endpoint cannot list or
# read anything else.  Build the game bundle on the host first (./build.sh;
# see README.md), then:
#
#   docker build -t xgalaga-hyperspace .
#   docker run -d --name xgalaga -p 8088:8088 -v "$PWD/data":/data xgalaga-hyperspace
#   # play: http://localhost:8088/
#
# All runtime knobs are environment variables read by leaderboard.py:
#   XGAL_PORT (8088)  XGAL_HOST (0.0.0.0)  XGAL_WEBDIR (/app/www)
#   XGAL_SCORES (/data/scores.json)  XGAL_MAX_HIGH_SCORES (100)  XGAL_ORIGIN (*)
#   XGAL_MAX_SCORE / XGAL_MAX_LEVEL / XGAL_MAX_BODY / XGAL_RATE_LIMIT / XGAL_RATE_WINDOW
#   XGAL_TRUSTED_PROXIES (127.0.0.1/32,::1/128)  XGAL_DEBUG_PANEL (false)
# See the docstring in leaderboard.py.
FROM python:3.12-slim

ENV XGAL_HOST=0.0.0.0 \
    XGAL_PORT=8088 \
    XGAL_WEBDIR=/app/www \
    XGAL_SCORES=/data/scores.json \
    XGAL_DEBUG_PANEL=false

WORKDIR /app

# Server outside the web root: the public endpoint can only serve the game.
COPY leaderboard.py ./
COPY web/ ./www/

# Scores persist in /data (mount a volume there). The server runs as
# 'nobody', so the directory must be owned by that user.
RUN mkdir -p /data && chown nobody /data
USER nobody

EXPOSE 8088
CMD ["python3", "-u", "leaderboard.py"]
