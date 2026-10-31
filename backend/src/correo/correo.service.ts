import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

@Injectable()
export class CorreoService {

    private readonly logger = new Logger(CorreoService.name);
    private readonly brevo: BrevoClient;
    private readonly remitenteEmail: string;
    private readonly remitenteNombre: string;

    constructor(private readonly config: ConfigService) {

        this.brevo = new BrevoClient({
            apiKey: this.config.getOrThrow<string>('BREVO_API_KEY'),
            maxRetries: 0
        });

        this.remitenteEmail =
            this.config.getOrThrow<string>('BREVO_REMITENTE_EMAIL');

        this.remitenteNombre =
            this.config.get<string>('BREVO_REMITENTE_NOMBRE')
            ?? 'Mi despedida';
    }

    // --------------------------------------------------
    // 1. Enviar una invitación para actuar como lanzador
    // --------------------------------------------------

    async enviarInvitacionLanzador(
        correo: string,
        nombre: string,
        enlace: string
    ): Promise<string> {

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Invitación como lanzador',
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has recibido una invitación para actuar como ' +
                        'lanzador en Mi despedida.\n\n' +
                        `Puedes consultar la invitación aquí:\n${enlace}\n\n` +
                        'Esta invitación tiene una vigencia de siete días. ' +
                        'Abrir el enlace no implica aceptarla.\n\n' +
                        'Para aceptar o rechazar tendrás que verificar ' +
                        'que tienes acceso al correo al que se ha enviado ' +
                        'esta invitación.\n\n' +
                        'No necesitas registrarte ni crear una cuenta ' +
                        'de administrador.\n\n' +
                        'Si aceptas, podrás solicitar posteriormente ' +
                        'un acceso temporal desde la web de Mi despedida. ' +
                        'No necesitarás conservar este correo para ello.\n\n' +
                        'Si no esperabas este mensaje, puedes ignorarlo.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha devuelto un identificador del mensaje.'
                );
            }

            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío de una invitación a Brevo',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del correo.'
            );
        }
    }

    // --------------------------------------------------
    // 2. Enviar un código de verificación al lanzador
    // --------------------------------------------------

    async enviarCodigoVerificacionLanzador(
        correo: string,
        nombre: string,
        codigo: string
    ): Promise<string> {

        // El código debe tener exactamente ocho dígitos
        if (!/^\d{8}$/.test(codigo)) {
            throw new InternalServerErrorException(
                'No se ha podido preparar el código de verificación.'
            );
        }

        try {
            const resultado =
                await this.brevo.transactionalEmails.sendTransacEmail({
                    sender: {
                        name: this.remitenteNombre,
                        email: this.remitenteEmail
                    },
                    to: [
                        {
                            email: correo,
                            name: nombre
                        }
                    ],
                    subject: 'Mi despedida - Código de verificación',
                    textContent:
                        `Hola, ${nombre}.\n\n` +
                        'Has solicitado verificar tu dirección de correo ' +
                        'para responder a una invitación como lanzador ' +
                        'en Mi despedida.\n\n' +
                        `Tu código de verificación es: ${codigo}\n\n` +
                        'Este código caduca a los 10 minutos.\n\n' +
                        'Introdúcelo en la pantalla donde estás ' +
                        'respondiendo a la invitación.\n\n' +
                        'Verificar tu correo no supone aceptar ' +
                        'automáticamente la invitación. ' +
                        'Después podrás elegir expresamente ' +
                        'si quieres aceptarla o rechazarla.\n\n' +
                        'No compartas este código con nadie.\n\n' +
                        'Si no has solicitado esta verificación, ' +
                        'puedes ignorar el mensaje.'
                });

            if (!resultado.messageId) {
                throw new Error(
                    'Brevo no ha confirmado la solicitud de envío del código.'
                );
            }

            // Solo devolvemos el identificador del mensaje.
            // No devolvemos ni registramos el código.
            return resultado.messageId;

        } catch (error) {
            this.logger.error(
                'Error al solicitar el envío del código de verificación',
                error instanceof Error ? error.message : String(error)
            );

            throw new InternalServerErrorException(
                'No se ha podido solicitar el envío del código de verificación.'
            );
        }
    }
}
