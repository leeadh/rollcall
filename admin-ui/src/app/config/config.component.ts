import { CheckProxy } from './../service/check-proxy.service';
import { Component, OnInit } from '@angular/core';
import * as proxyconf from '../../../proxy-config.json';

@Component({
  selector: 'app-config',
  templateUrl: './config.component.html',
  styleUrls: ['./config.component.scss']
})
export class ConfigComponent implements OnInit {
  isAlive: boolean;
  checkResult: {};
  proxyconfig: any = (proxyconf as any).default;
  constructor(private CheckProxy: CheckProxy) { }

 ngOnInit(): void {
  console.log(this.proxyconfig);
  this.CheckProxy.checkProxy().subscribe(headers => {
    this.checkResult = headers;
    console.log(this.checkResult);
    if (this.checkResult) {
      this.isAlive = true;
    }
  });
  }
}
