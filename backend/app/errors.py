"""One error shape for the whole gateway: {"error": {"code": ..., "message": ...}}."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError):
        errors = exc.errors()
        if any(e["type"] == "json_invalid" for e in errors):
            return error_response(400, "bad_json", "Body bukan JSON")
        first = errors[0]
        where = ".".join(str(p) for p in first["loc"])
        return error_response(400, "invalid_request", f"{where}: {first['msg']}")

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return error_response(
            exc.status_code, HTTP_CODES.get(exc.status_code, "http_error"), str(exc.detail)
        )
