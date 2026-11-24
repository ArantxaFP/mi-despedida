import { IsString, IsUUID, MinLength } from 'class-validator';

export class SeleccionarAdministradorLanzadorDto {
    @IsString({
        message: 'El token temporal no es válido.'
    })
    @MinLength(10, {
        message: 'El token temporal no es válido.'
    })
    tokenSeleccion: string;

    @IsUUID('4', {
        message: 'La asignación seleccionada no es válida.'
    })
    asignacionId: string;
}