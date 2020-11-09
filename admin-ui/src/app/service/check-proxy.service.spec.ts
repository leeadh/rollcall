import { TestBed } from '@angular/core/testing';

import { CheckProxyService } from './check-proxy.service';

describe('CheckProxyService', () => {
  let service: CheckProxyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CheckProxyService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
