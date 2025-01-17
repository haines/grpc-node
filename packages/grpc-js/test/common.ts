/*
 * Copyright 2019 gRPC authors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as loader from '@grpc/proto-loader';
import * as assert2 from './assert2';
import * as path from 'path';
import * as grpc from '../src';

import {
  GrpcObject,
  ServiceClientConstructor,
  ServiceClient,
  loadPackageDefinition,
} from '../src/make-client';
import { readFileSync } from 'fs';

const protoLoaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

export function mockFunction(): never {
  throw new Error('Not implemented');
}

export function loadProtoFile(file: string): GrpcObject {
  const packageDefinition = loader.loadSync(file, protoLoaderOptions);
  return loadPackageDefinition(packageDefinition);
}

const protoFile = path.join(__dirname, 'fixtures', 'echo_service.proto');
const echoService = loadProtoFile(protoFile)
  .EchoService as ServiceClientConstructor;

const ca = readFileSync(path.join(__dirname, 'fixtures', 'ca.pem'));
const key = readFileSync(path.join(__dirname, 'fixtures', 'server1.key'));
const cert = readFileSync(path.join(__dirname, 'fixtures', 'server1.pem'));

const serviceImpl = {
  echo: (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ) => {
    callback(null, call.request);
  },
};

export class TestServer {
  private server: grpc.Server;
  public port: number | null = null;
  constructor(public useTls: boolean, options?: grpc.ChannelOptions) {
    this.server = new grpc.Server(options);
    this.server.addService(echoService.service, serviceImpl);
  }
  start(): Promise<void> {
    let credentials: grpc.ServerCredentials;
    if (this.useTls) {
      credentials = grpc.ServerCredentials.createSsl(null, [
        { private_key: key, cert_chain: cert },
      ]);
    } else {
      credentials = grpc.ServerCredentials.createInsecure();
    }
    return new Promise<void>((resolve, reject) => {
      this.server.bindAsync('localhost:0', credentials, (error, port) => {
        if (error) {
          reject(error);
          return;
        }
        this.port = port;
        this.server.start();
        resolve();
      });
    });
  }

  shutdown() {
    this.server.forceShutdown();
  }
}

export class TestClient {
  private client: ServiceClient;
  constructor(port: number, useTls: boolean, options?: grpc.ChannelOptions) {
    let credentials: grpc.ChannelCredentials;
    if (useTls) {
      credentials = grpc.credentials.createSsl(ca);
    } else {
      credentials = grpc.credentials.createInsecure();
    }
    this.client = new echoService(`localhost:${port}`, credentials, options);
  }

  static createFromServer(server: TestServer, options?: grpc.ChannelOptions) {
    if (server.port === null) {
      throw new Error('Cannot create client, server not started');
    }
    return new TestClient(server.port, server.useTls, options);
  }

  waitForReady(deadline: grpc.Deadline, callback: (error?: Error) => void) {
    this.client.waitForReady(deadline, callback);
  }

  sendRequest(callback: (error: grpc.ServiceError) => void) {
    this.client.echo({}, callback);
  }

  getChannelState() {
    return this.client.getChannel().getConnectivityState(false);
  }

  close() {
    this.client.close();
  }
}

export { assert2 };
