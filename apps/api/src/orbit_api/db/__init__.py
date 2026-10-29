"""Database infrastructure: engines, sessions, ORM base, and migrations.

This package is the only place that knows which database backs the selected storage mode.
It depends on SQLAlchemy and Alembic but not on FastAPI.
"""
