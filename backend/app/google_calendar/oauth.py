from authlib.integrations.starlette_client import OAuth

from app.config import settings

calendar_oauth = OAuth()
calendar_oauth.register(
    name="google_calendar",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email https://www.googleapis.com/auth/calendar",
        "prompt": "consent",
    },
)
