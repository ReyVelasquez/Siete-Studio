"""Pydantic v2 schemas for user profile, RBAC user CRUD, and admin password restoration."""

from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UserRoleCode(str, Enum):
    ADMIN = "admin"
    OPERADOR = "operador"
    CLIENTE = "cliente"


class UserProfileResponse(BaseModel):
    id: int
    firebase_uid: str
    email: str
    display_name: str
    role: UserRoleCode
    role_name: str
    email_verified: bool
    is_active: bool
    auth_provider: str
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: List[UserProfileResponse]
    total: int


def _validate_strong_password(password: str) -> str:
    if len(password) < 8:
        raise ValueError("La contraseña debe tener al menos 8 caracteres.")
    if not re.search(r"[A-Za-z]", password):
        raise ValueError("La contraseña debe incluir al menos una letra.")
    if not re.search(r"[0-9]", password):
        raise ValueError("La contraseña debe incluir al menos un número.")
    return password


class AdminCreateUserInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., min_length=5, max_length=255)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRoleCode = UserRoleCode.OPERADOR
    email_verified: bool = False

    @field_validator("email")
    @classmethod
    def check_email(cls, v: str) -> str:
        val = v.lower()
        if "@" not in val or "." not in val.split("@")[-1]:
            raise ValueError("Ingresa un correo electrónico válido.")
        return val

    @field_validator("password")
    @classmethod
    def check_password(cls, v: str) -> str:
        return _validate_strong_password(v)


class AdminUpdateUserInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[UserRoleCode] = None
    is_active: Optional[bool] = None
    email_verified: Optional[bool] = None


class AdminPasswordRestoreMode(str, Enum):
    TEMPORARY_PASSWORD = "temporary_password"
    RESET_LINK = "reset_link"


class AdminRestorePasswordInput(BaseModel):
    mode: AdminPasswordRestoreMode
    new_password: Optional[str] = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "AdminRestorePasswordInput":
        if self.mode == AdminPasswordRestoreMode.TEMPORARY_PASSWORD:
            if not self.new_password:
                raise ValueError(
                    "Debes especificar la nueva contraseña temporal para restaurar el acceso."
                )
            _validate_strong_password(self.new_password)
        return self


class AdminRestorePasswordResponse(BaseModel):
    user_id: int
    email: str
    mode: AdminPasswordRestoreMode
    message: str
    reset_link: Optional[str] = None
