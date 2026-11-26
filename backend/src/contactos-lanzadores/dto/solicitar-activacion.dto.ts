import { IsString, IsNotEmpty, IsOptional, MaxLength, Equals } from 'class-validator';
import { Transform } from 'class-transformer';

export class SolicitarActivacionDto {

    // Comunicación general obligatoria redactada por el primer lanzador
    // Es obligatoria por si el administrador no tenía ningún mensaje personalizado redactado
    // Así se garantiza que hay algún contenido que enviar
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    @IsString()
    @IsNotEmpty({
        message: 'Debes introducir una comunicación general.'
    })
    @MaxLength(5000)
    mensajeGeneral!: string;


    // Información opcional del velatorio o ceremonia
    // Es opcional porque quizá no se vaya a realizar ningún tipo de ritual o ceremonia
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value
    )
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    informacionCeremonia?: string;


    // El lanzador debe confirmar expresamente que quiere solicitar la activación
    @Equals(true, {
        message: 'Debes confirmar expresamente la solicitud de activación.'
    })
    confirmaSolicitud!: boolean;

}