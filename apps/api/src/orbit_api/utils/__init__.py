"""Small helpers shared across features: plain Python with no FastAPI, SQLAlchemy, or Pydantic,
so any layer may import them. Helpers tied to a framework stay in their layer
(`repositories/transaction.py`, `schemas/common.py`)."""
