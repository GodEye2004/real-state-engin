import logging

# Logging configuration
logger = logging.getLogger("divar_scraper")
logging.basicConfig(level=logging.INFO)

# DB Config
DB_CONFIG = {
    "host": "localhost",
    "port": 5433,
    "database": "real-state-agent",
    "user": "postgres",
    "password": "mo90mo80"
}

# Divar Config
CATEGORY_URL = "https://divar.ir/s/gorgan/buy-apartment"

# API & AI Config
GITHUB_TOKEN = "***REMOVED***"
ENDPOINT = "https://models.inference.ai.azure.com"
MODEL_NAME = "gpt-4o"
