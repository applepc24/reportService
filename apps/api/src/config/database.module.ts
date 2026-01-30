import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      username: process.env.DB_USER || "app",
      password: process.env.DB_PASSWORD || "app_pw",
      database: process.env.DB_NAME || "pubinsight",
      autoLoadEntities: true, // 각 모듈에서 등록한 엔티티 자동 로딩
      synchronize: false, // 우리는 ddl.sql로 테이블 만들었으니까 false
      logging: ["error", "warn"], // 콘솔에 SQL 로그 찍기
      // ssl: {
      //   rejectUnauthorized: false,
      // },
    }),
  ],
})
export class DatabaseModule {}
