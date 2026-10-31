import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export function obtenerUrlBackoffice(
    config: ConfigService,
    origen?: string
): string {

    const urlLocal = config.getOrThrow<string>(
        'BACKOFFICE_URL_LOCAL'
    ).replace(/\/+$/, '');

    const urlProduccion = config.getOrThrow<string>(
        'BACKOFFICE_URL_PRODUCCION'
    ).replace(/\/+$/, '');

    if (origen === urlLocal) {
        return urlLocal;
    }

    if (origen === urlProduccion) {
        return urlProduccion;
    }

    throw new BadRequestException(
        'El origen de la solicitud no está autorizado.'
    );
}
