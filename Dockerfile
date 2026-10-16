# XGalaga: Hyperspace — game + shared high-score leaderboard.
#
# The image ships ONLY the deployed artifacts (leaderboard.py + the game
# page/bundle), not the source tree, so a public endpoint cannot list or
# read anything else. Build the game bundle on the host first
# (xgalaga-2.1.1.0/web/build.sh; see xgalaga-2.1.1.0/web/README.md), then:
#
#   docker build -t xgalaga-hyperspace .
#   docker run -d --name xgalaga -p 8088:8088 -v xgalaga-scores:/data xgalaga-hyperspace
#   # play: http://localhost:8088/
#
# All runtime knobs are environment variables read by leaderboard.py:
#   XGAL_PORT (8088)  XGAL_HOST (0.0.0.0)  XGAL_WEBDIR (/app/www)
#   XGAL_SCORES (/data/scores.json)  XGAL_MAX (100)  XGAL_ORIGIN (*)
#   XGAL_MAX_SCORE / XGAL_MAX_LEVEL / XGAL_MAX_BODY / XGAL_RATE_LIMIT / XGAL_RATE_WINDOW
# See the docstring in xgalaga-2.1.1.0/web/leaderboard.py.
FROM python:3.12-slim

ENV XGAL_HOST=0.0.0.0 \
    XGAL_PORT=8088 \
    XGAL_WEBDIR=/app/www \
    XGAL_SCORES=/data/scores.json

WORKDIR /app

# Server outside the web root: the public endpoint can only serve the game.
COPY xgalaga-2.1.1.0/web/leaderboard.py ./
COPY xgalaga-2.1.1.0/web/index.html ./www/
COPY xgalaga-2.1.1.0/web/xgalaga.js ./www/
COPY xgalaga-2.1.1.0/web/favicon.ico ./www/
COPY xgalaga-2.1.1.0/web/icon.png ./www/

# Scores persist in /data (mount a volume there). The server runs as
# 'nobody', so the directory must be owned by that user.
RUN mkdir -p /data && chown nobody /data
USER nobody

EXPOSE 8088
CMD ["python3", "-u", "leaderboard.py"]
