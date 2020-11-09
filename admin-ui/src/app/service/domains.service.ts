import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class DomainsService {
createError
createSuccess
isError:boolean
isSuccess:boolean

constructor(private httpClient: HttpClient) { }

public getDomains(): Observable<any[]> {
  return this.httpClient.get<any[]>("/access/connectormanagement/directoryconfigs")
  };

  options = {
    observe: "response" as "body"
}

public createDirectory(postbody): Observable<any[]> {

  return this.httpClient.post<any[]>('/access/connectormanagement/directoryconfigs', postbody, this.options)
}

}
