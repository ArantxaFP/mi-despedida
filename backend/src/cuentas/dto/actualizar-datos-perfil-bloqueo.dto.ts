import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { ActualizarDatosCuentaDto } from './actualizar-datos-cuenta.dto';

export class ActualizarDatosPerfilBloqueoDto extends ActualizarDatosCuentaDto {
    @IsString()
    @Matches(/^[a-f0-9]{64}$/)
    token: string;

    @IsInt()
    @Min(1)
    @Max(2_147_483_647)
    versionEsperada: number;
}